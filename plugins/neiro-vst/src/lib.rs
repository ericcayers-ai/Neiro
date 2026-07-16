//! Neiro DAW injector — VST2 effect that shares **one** Neiro window.
//!
//! Insert this plugin on any number of DAW tracks. Opening the plugin editor
//! does **not** embed a second UI: it POSTs `/api/daw/show-ui` so the running
//! Neiro desktop/browser window focuses Learn mode for that instance.
//!
//! Audio is passed through (true injector). MIDI note-ons from the host are
//! forwarded into Neiro Learn wait mode.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use vst::api::Supported;
use vst::buffer::AudioBuffer;
use vst::editor::Editor;
use vst::event::{Event, MidiEvent};
use vst::plugin::{CanDo, Category, HostCallback, Info, Plugin, PluginParameters};

const ENGINE_HOST: &str = "127.0.0.1:8377";
static INSTANCE_COUNTER: AtomicU64 = AtomicU64::new(1);

fn http_post_json(path: &str, payload: &str) -> Result<(), String> {
    let mut stream = TcpStream::connect(ENGINE_HOST).map_err(|e| e.to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    let req = format!(
        "POST {path} HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = [0u8; 256];
    let _ = stream.read(&mut buf);
    Ok(())
}

fn json_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

struct SharedEditor {
    instance_id: String,
}

impl Editor for SharedEditor {
    fn size(&self) -> (i32, i32) {
        (0, 0)
    }

    fn position(&self) -> (i32, i32) {
        (0, 0)
    }

    fn open(&mut self, _parent: *mut std::ffi::c_void) -> bool {
        let body = format!(
            r#"{{"instance_id":"{}","module":"learn","launch_if_needed":true}}"#,
            json_escape(&self.instance_id)
        );
        let _ = http_post_json("/api/daw/show-ui", &body);
        true
    }

    fn is_open(&mut self) -> bool {
        false
    }
}

struct NeiroDaw {
    host: HostCallback,
    instance_id: String,
    sample_rate: f32,
    registered: bool,
    process_calls: u32,
}

impl Default for NeiroDaw {
    fn default() -> Self {
        let n = INSTANCE_COUNTER.fetch_add(1, Ordering::Relaxed);
        Self {
            host: HostCallback::default(),
            instance_id: format!("daw-{n:08x}"),
            sample_rate: 44100.0,
            registered: false,
            process_calls: 0,
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
            version: 10_000,
            inputs: 2,
            outputs: 2,
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
    }

    fn process(&mut self, buffer: &mut AudioBuffer<f32>) {
        let mut peak = 0.0f32;
        let mut frames = 0usize;
        for (input, output) in buffer.zip() {
            for (i, o) in input.iter().zip(output.iter_mut()) {
                *o = *i;
                peak = peak.max(i.abs());
                frames += 1;
            }
        }
        self.process_calls = self.process_calls.wrapping_add(1);
        if self.process_calls % 128 == 0 {
            let body = format!(
                r#"{{"instance_id":"{}","peak":{:.6},"frames":{}}}"#,
                json_escape(&self.instance_id),
                peak,
                frames
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
        let body = format!(
            r#"{{"instance_id":"{}","module":"learn","launch_if_needed":true}}"#,
            json_escape(&self.instance_id)
        );
        let _ = http_post_json("/api/daw/show-ui", &body);
        Some(Box::new(SharedEditor {
            instance_id: self.instance_id.clone(),
        }))
    }

    fn get_parameter_object(&mut self) -> std::sync::Arc<dyn PluginParameters> {
        struct Empty;
        impl PluginParameters for Empty {}
        std::sync::Arc::new(Empty)
    }
}

impl NeiroDaw {
    fn ensure_registered(&mut self, host: &str) -> Result<(), String> {
        if self.registered {
            return Ok(());
        }
        let body = format!(
            r#"{{"instance_id":"{}","track_name":"Neiro injector","plugin_role":"injector","host":"{}","sample_rate":{},"channels":2}}"#,
            json_escape(&self.instance_id),
            json_escape(host),
            self.sample_rate as i32
        );
        http_post_json("/api/daw/register", &body)?;
        self.registered = true;
        Ok(())
    }
}

impl Drop for NeiroDaw {
    fn drop(&mut self) {
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
