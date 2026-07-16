//! Neiro DAW injector — VST2 effect that shares **one** Neiro window.
//!
//! Insert this plugin on any number of DAW tracks. Opening the plugin editor
//! does **not** embed a second UI: it POSTs `/api/daw/show-ui` so the running
//! Neiro desktop/browser window focuses the selected mode for that instance.
//!
//! Parameters (automation-friendly):
//! - **Record** — arm/record track audio into a buffer; releasing stops and
//!   uploads a WAV capture to Neiro (Edison-style) for Separate/Restore/etc.
//! - **Target Mode** — which Neiro module the shared window opens after
//!   show-ui or after a capture finishes.
//! - **Open UI** — pulse (>0.5) focuses the shared Neiro window on Target Mode.
//!
//! Audio is passed through (true injector). MIDI note-ons from the host are
//! forwarded into Neiro Learn wait mode.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use vst::api::Supported;
use vst::buffer::AudioBuffer;
use vst::editor::Editor;
use vst::event::{Event, MidiEvent};
use vst::plugin::{CanDo, Category, HostCallback, Info, Plugin, PluginParameters};

const ENGINE_HOST: &str = "127.0.0.1:8377";
static INSTANCE_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Soft cap ~2 minutes of stereo float @ 48 kHz (~22 MB) before samples are dropped.
const MAX_CAPTURE_SAMPLES: usize = 48_000 * 2 * 120;

const MODULES: &[&str] = &[
    "import",
    "analysis",
    "studio",
    "separate",
    "restore",
    "transcribe",
    "mixer",
    "learn",
    "preferences",
    "about",
];

fn http_post_json(path: &str, payload: &str) -> Result<(), String> {
    let mut stream = TcpStream::connect(ENGINE_HOST).map_err(|e| e.to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let req = format!(
        "POST {path} HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = [0u8; 256];
    let _ = stream.read(&mut buf);
    Ok(())
}

fn http_post_wav(
    path: &str,
    wav: &[u8],
    instance_id: &str,
    filename: &str,
    module: &str,
) -> Result<(), String> {
    let mut stream = TcpStream::connect(ENGINE_HOST).map_err(|e| e.to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let header = format!(
        "POST {path} HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Type: audio/wav\r\nContent-Length: {}\r\nX-Instance-Id: {}\r\nX-Filename: {}\r\nX-Module: {}\r\nConnection: close\r\n\r\n",
        wav.len(),
        instance_id,
        filename,
        module
    );
    stream.write_all(header.as_bytes()).map_err(|e| e.to_string())?;
    stream.write_all(wav).map_err(|e| e.to_string())?;
    let mut buf = [0u8; 512];
    let _ = stream.read(&mut buf);
    Ok(())
}

fn json_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn module_from_param(v: f32) -> &'static str {
    let n = MODULES.len();
    let idx = ((v.clamp(0.0, 1.0) * (n as f32 - 1e-6)) as usize).min(n - 1);
    MODULES[idx]
}

fn encode_wav_i16(interleaved: &[f32], sample_rate: u32, channels: u16) -> Vec<u8> {
    let ch = channels.max(1) as usize;
    let n_frames = interleaved.len() / ch;
    let data_bytes = (n_frames * ch * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_bytes as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.max(1).to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate * channels.max(1) as u32 * 2;
    out.extend_from_slice(&byte_rate.to_le_bytes());
    let block_align = channels.max(1) * 2;
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_bytes.to_le_bytes());
    for &s in interleaved {
        let clamped = s.clamp(-1.0, 1.0);
        let i = (clamped * 32767.0) as i16;
        out.extend_from_slice(&i.to_le_bytes());
    }
    out
}

struct SharedEditor {
    instance_id: String,
    params: Arc<NeiroParams>,
}

impl Editor for SharedEditor {
    fn size(&self) -> (i32, i32) {
        (0, 0)
    }

    fn position(&self) -> (i32, i32) {
        (0, 0)
    }

    fn open(&mut self, _parent: *mut std::ffi::c_void) -> bool {
        let module = self.params.current_module();
        let body = format!(
            r#"{{"instance_id":"{}","module":"{}","launch_if_needed":true}}"#,
            json_escape(&self.instance_id),
            json_escape(module)
        );
        let _ = http_post_json("/api/daw/show-ui", &body);
        true
    }

    fn is_open(&mut self) -> bool {
        false
    }
}

struct NeiroParams {
    /// 0 = idle, 1 = recording
    record: AtomicU32,
    /// bits of f32 0..1 mapped across MODULES
    target_mode: AtomicU32,
    /// pulse: rising edge opens UI
    open_ui: AtomicU32,
    was_recording: AtomicBool,
    open_ui_latched: AtomicBool,
    buffer: Mutex<Vec<f32>>,
    instance_id: Mutex<String>,
    sample_rate: AtomicU32,
    flush_busy: AtomicBool,
}

impl NeiroParams {
    fn new(instance_id: String) -> Self {
        // Default target ≈ Separate (index 3)
        let default_mode = 3.0 / (MODULES.len() as f32 - 1.0);
        Self {
            record: AtomicU32::new(0),
            target_mode: AtomicU32::new(default_mode.to_bits()),
            open_ui: AtomicU32::new(0),
            was_recording: AtomicBool::new(false),
            open_ui_latched: AtomicBool::new(false),
            buffer: Mutex::new(Vec::with_capacity(8192)),
            instance_id: Mutex::new(instance_id),
            sample_rate: AtomicU32::new(44100),
            flush_busy: AtomicBool::new(false),
        }
    }

    fn current_module(&self) -> &'static str {
        module_from_param(f32::from_bits(self.target_mode.load(Ordering::Relaxed)))
    }

    fn is_recording(&self) -> bool {
        self.record.load(Ordering::Relaxed) > 0
    }

    fn append_stereo_frame(&self, left: f32, right: f32) {
        if !self.is_recording() {
            return;
        }
        let Ok(mut buf) = self.buffer.lock() else {
            return;
        };
        if buf.len() + 2 > MAX_CAPTURE_SAMPLES {
            return;
        }
        buf.push(left);
        buf.push(right);
    }

    fn begin_or_end_record(&self) {
        let recording = self.is_recording();
        let was = self.was_recording.swap(recording, Ordering::SeqCst);
        if recording && !was {
            if let Ok(mut buf) = self.buffer.lock() {
                buf.clear();
            }
        }
        if was && !recording {
            self.spawn_flush();
        }
    }

    fn maybe_open_ui_pulse(&self) {
        let open = self.open_ui.load(Ordering::Relaxed) > 0;
        let was = self.open_ui_latched.swap(open, Ordering::SeqCst);
        if open && !was {
            let id = self
                .instance_id
                .lock()
                .ok()
                .map(|g| g.clone())
                .unwrap_or_default();
            let module = self.current_module().to_string();
            thread::spawn(move || {
                let body = format!(
                    r#"{{"instance_id":"{}","module":"{}","launch_if_needed":true}}"#,
                    json_escape(&id),
                    json_escape(&module)
                );
                let _ = http_post_json("/api/daw/show-ui", &body);
            });
        }
    }

    fn spawn_flush(&self) {
        if self
            .flush_busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let samples = match self.buffer.lock() {
            Ok(mut buf) => std::mem::take(&mut *buf),
            Err(_) => {
                self.flush_busy.store(false, Ordering::SeqCst);
                return;
            }
        };
        if samples.is_empty() {
            self.flush_busy.store(false, Ordering::SeqCst);
            return;
        }
        let id = self
            .instance_id
            .lock()
            .ok()
            .map(|g| g.clone())
            .unwrap_or_default();
        let module = self.current_module().to_string();
        let sr = self.sample_rate.load(Ordering::Relaxed).max(1);
        // We cannot move AtomicBool out of &self; reset busy after the post
        // by using a detached pattern: encode+post on this thread's spawn, and
        // clear busy via a second AtomicBool... Use compare at start; store false
        // at end of spawned closure by leaking a pointer is bad. Instead encode
        // on the calling thread (may be UI thread) then spawn only HTTP.
        let wav = encode_wav_i16(&samples, sr, 2);
        let filename = format!("daw-capture-{id}.wav");
        // Mark not-busy after spawn starts owning the work — use scoped flag via
        // Arc wrap of a one-shot. Simplest: do HTTP on background and reset via
        // cloning nothing — store false in finally of spawn by capturing a raw
        // approach: keep flush_busy true until done using unsafe... 
        // Practical fix: do the HTTP inline in the spawn and reset using
        // `AtomicBool` address — we need Arc<NeiroParams>. Callers use
        // `spawn_flush_arc`.
        let _ = (wav, filename, module, id);
        self.flush_busy.store(false, Ordering::SeqCst);
    }
}

fn spawn_flush_arc(params: Arc<NeiroParams>) {
    if params
        .flush_busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let samples = match params.buffer.lock() {
        Ok(mut buf) => std::mem::take(&mut *buf),
        Err(_) => {
            params.flush_busy.store(false, Ordering::SeqCst);
            return;
        }
    };
    if samples.is_empty() {
        params.flush_busy.store(false, Ordering::SeqCst);
        return;
    }
    let id = params
        .instance_id
        .lock()
        .ok()
        .map(|g| g.clone())
        .unwrap_or_default();
    let module = params.current_module().to_string();
    let sr = params.sample_rate.load(Ordering::Relaxed).max(1);
    thread::spawn(move || {
        let wav = encode_wav_i16(&samples, sr, 2);
        let filename = format!("daw-capture-{id}.wav");
        let _ = http_post_wav("/api/daw/capture", &wav, &id, &filename, &module);
        params.flush_busy.store(false, Ordering::SeqCst);
    });
}

impl PluginParameters for NeiroParams {
    fn get_parameter_name(&self, index: i32) -> String {
        match index {
            0 => "Record".into(),
            1 => "Target Mode".into(),
            2 => "Open UI".into(),
            _ => format!("Param {index}"),
        }
    }

    fn get_parameter_text(&self, index: i32) -> String {
        match index {
            0 => {
                if self.is_recording() {
                    "Recording".into()
                } else {
                    "Idle".into()
                }
            }
            1 => self.current_module().into(),
            2 => {
                if self.open_ui.load(Ordering::Relaxed) > 0 {
                    "Fire".into()
                } else {
                    "Off".into()
                }
            }
            _ => String::new(),
        }
    }

    fn get_parameter_label(&self, index: i32) -> String {
        match index {
            0 => "rec".into(),
            1 => "mode".into(),
            2 => "ui".into(),
            _ => String::new(),
        }
    }

    fn get_parameter(&self, index: i32) -> f32 {
        match index {
            0 => {
                if self.is_recording() {
                    1.0
                } else {
                    0.0
                }
            }
            1 => f32::from_bits(self.target_mode.load(Ordering::Relaxed)),
            2 => {
                if self.open_ui.load(Ordering::Relaxed) > 0 {
                    1.0
                } else {
                    0.0
                }
            }
            _ => 0.0,
        }
    }

    fn set_parameter(&self, index: i32, value: f32) {
        match index {
            0 => {
                let on = value >= 0.5;
                self.record.store(if on { 1 } else { 0 }, Ordering::Relaxed);
                // Note: flush is deferred to the audio thread via pending_flush
                // because PluginParameters is not Arc-aware here. See process().
                let recording = on;
                let was = self.was_recording.swap(recording, Ordering::SeqCst);
                if recording && !was {
                    if let Ok(mut buf) = self.buffer.lock() {
                        buf.clear();
                    }
                }
                if was && !recording {
                    self.pending_flush_store();
                }
            }
            1 => {
                self.target_mode
                    .store(value.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
            }
            2 => {
                let on = value >= 0.5;
                self.open_ui.store(if on { 1 } else { 0 }, Ordering::Relaxed);
                self.maybe_open_ui_pulse();
            }
            _ => {}
        }
    }
}

impl NeiroParams {
    fn pending_flush_store(&self) {
        // Signal audio thread — AtomicBool reused: was_recording already false;
        // use open_ui unused bit... dedicated flag:
        // We store "needs flush" in flush_busy's sibling — add AtomicBool pending_flush.
    }
}

struct NeiroDaw {
    host: HostCallback,
    instance_id: String,
    sample_rate: f32,
    registered: bool,
    process_calls: u32,
    params: Arc<NeiroParams>,
    pending_flush: Arc<AtomicBool>,
}

impl Default for NeiroDaw {
    fn default() -> Self {
        let n = INSTANCE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let instance_id = format!("daw-{n:08x}");
        Self {
            host: HostCallback::default(),
            instance_id: instance_id.clone(),
            sample_rate: 44100.0,
            registered: false,
            process_calls: 0,
            params: Arc::new(NeiroParams::new(instance_id)),
            pending_flush: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl Plugin for NeiroDaw {
    fn new(host: HostCallback) -> Self {
        let mut plugin = Self::default();
        plugin.host = host;
        plugin
    }

    fn get_info(&self) -> Info {
        Info {
            name: "Neiro DAW Bridge".to_string(),
            vendor: "Neiro".to_string(),
            unique_id: 0x4E45_4952, // 'NEIR'
            version: 11_000,
            inputs: 2,
            outputs: 2,
            parameters: 3,
            category: Category::Effect,
            initial_delay: 0,
            preset_chunks: false,
            f64_precision: false,
            silent_when_stopped: true,
            ..Default::default()
        }
    }

    fn init(&mut self) {
        let _ = self.ensure_registered("unknown");
    }

    fn set_sample_rate(&mut self, rate: f32) {
        self.sample_rate = rate;
        self.params
            .sample_rate
            .store(rate.max(1.0) as u32, Ordering::Relaxed);
    }

    fn process(&mut self, buffer: &mut AudioBuffer<f32>) {
        let mut peak = 0.0f32;
        let mut frames = 0usize;

        // Collect channel slices for stereo interleave + pass-through.
        let (inputs, mut outputs) = buffer.split();
        let n_in = inputs.len();
        if n_in == 0 {
            return;
        }
        let frames_n = inputs.get(0).len();
        let recording = self.params.is_recording();

        for i in 0..frames_n {
            let l = inputs.get(0)[i];
            let r = if n_in > 1 { inputs.get(1)[i] } else { l };
            peak = peak.max(l.abs()).max(r.abs());
            if recording {
                self.params.append_stereo_frame(l, r);
            }
            if let Some(lo) = outputs.get_mut(0) {
                lo[i] = l;
            }
            if outputs.len() > 1 {
                if let Some(ro) = outputs.get_mut(1) {
                    ro[i] = r;
                }
            }
        }
        frames = frames_n;

        if self.pending_flush.swap(false, Ordering::SeqCst) {
            spawn_flush_arc(Arc::clone(&self.params));
        }

        self.process_calls = self.process_calls.wrapping_add(1);
        if self.process_calls % 128 == 0 {
            let module = self.params.current_module();
            let body = format!(
                r#"{{"instance_id":"{}","peak":{:.6},"frames":{},"recording":{},"preferred_module":"{}"}}"#,
                json_escape(&self.instance_id),
                peak,
                frames,
                if recording { "true" } else { "false" },
                json_escape(module)
            );
            let _ = http_post_json("/api/daw/heartbeat", &body);
        }
    }

    fn process_events(&mut self, events: &vst::api::Events) {
        for event in events.events() {
            if let Event::Midi(MidiEvent { data, .. }) = event {
                let status = data[0] & 0xf0;
                let pitch = data[1] as i32;
                let velocity = data[2] as i32;
                let note_on = status == 0x90 && velocity > 0;
                let note_off = status == 0x80 || (status == 0x90 && velocity == 0);
                if note_on || note_off {
                    let _ = self.ensure_registered("daw-host");
                    let body = format!(
                        r#"{{"instance_id":"{}","pitch":{},"velocity":{},"note_on":{}}}"#,
                        json_escape(&self.instance_id),
                        pitch,
                        velocity,
                        if note_on { "true" } else { "false" }
                    );
                    let _ = http_post_json("/api/daw/midi", &body);
                }
            }
        }
    }

    fn can_do(&self, can_do: CanDo) -> Supported {
        match can_do {
            CanDo::ReceiveMidiEvent | CanDo::SendMidiEvent | CanDo::ReceiveTimeInfo => {
                Supported::Yes
            }
            _ => Supported::Maybe,
        }
    }

    fn get_editor(&mut self) -> Option<Box<dyn Editor>> {
        let _ = self.ensure_registered("daw-host");
        let module = self.params.current_module();
        let body = format!(
            r#"{{"instance_id":"{}","module":"{}","launch_if_needed":true}}"#,
            json_escape(&self.instance_id),
            json_escape(module)
        );
        let _ = http_post_json("/api/daw/show-ui", &body);
        Some(Box::new(SharedEditor {
            instance_id: self.instance_id.clone(),
            params: Arc::clone(&self.params),
        }))
    }

    fn get_parameter_object(&mut self) -> Arc<dyn PluginParameters> {
        // Wrap so Record-off can set pending_flush on the plugin.
        Arc::new(NeiroParamsProxy {
            inner: Arc::clone(&self.params),
            pending_flush: Arc::clone(&self.pending_flush),
        }) as Arc<dyn PluginParameters>
    }
}

/// Forwards parameters and marks a capture flush when Record turns off.
struct NeiroParamsProxy {
    inner: Arc<NeiroParams>,
    pending_flush: Arc<AtomicBool>,
}

impl PluginParameters for NeiroParamsProxy {
    fn get_parameter_name(&self, index: i32) -> String {
        self.inner.get_parameter_name(index)
    }
    fn get_parameter_text(&self, index: i32) -> String {
        self.inner.get_parameter_text(index)
    }
    fn get_parameter_label(&self, index: i32) -> String {
        self.inner.get_parameter_label(index)
    }
    fn get_parameter(&self, index: i32) -> f32 {
        self.inner.get_parameter(index)
    }
    fn set_parameter(&self, index: i32, value: f32) {
        if index == 0 {
            let on = value >= 0.5;
            let was = self.inner.is_recording();
            self.inner
                .record
                .store(if on { 1 } else { 0 }, Ordering::Relaxed);
            let _ = self.inner.was_recording.swap(on, Ordering::SeqCst);
            if on && !was {
                if let Ok(mut buf) = self.inner.buffer.lock() {
                    buf.clear();
                }
            }
            if was && !on {
                self.pending_flush.store(true, Ordering::SeqCst);
            }
            return;
        }
        self.inner.set_parameter(index, value);
    }
}

impl NeiroDaw {
    fn ensure_registered(&mut self, host: &str) -> Result<(), String> {
        if self.registered {
            return Ok(());
        }
        let module = self.params.current_module();
        let body = format!(
            r#"{{"instance_id":"{}","track_name":"Neiro injector","plugin_role":"injector","host":"{}","sample_rate":{},"channels":2,"preferred_module":"{}"}}"#,
            json_escape(&self.instance_id),
            json_escape(host),
            self.sample_rate as i32,
            json_escape(module)
        );
        http_post_json("/api/daw/register", &body)?;
        self.registered = true;
        Ok(())
    }
}

impl Drop for NeiroDaw {
    fn drop(&mut self) {
        if self.params.is_recording() || !self.params.buffer.lock().map(|b| b.is_empty()).unwrap_or(true)
        {
            self.params.record.store(0, Ordering::Relaxed);
            spawn_flush_arc(Arc::clone(&self.params));
            // Give the flush thread a brief moment before unregister.
            thread::sleep(Duration::from_millis(50));
        }
        if self.registered {
            let body = format!(
                r#"{{"instance_id":"{}"}}"#,
                json_escape(&self.instance_id)
            );
            let _ = http_post_json("/api/daw/unregister", &body);
        }
        let _ = self.host;
    }
}

vst::plugin_main!(NeiroDaw);
