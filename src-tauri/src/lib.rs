//! Neiro Tauri shell — supervises the local Python HTTP engine with health restart.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, State};

const PORT: u16 = 8377;
const ENGINE_URL: &str = "http://127.0.0.1:8377/";
const HEALTH_PATH: &str = "/api/health";

struct EngineProcess(Mutex<EngineState>);

struct EngineState {
  child: Option<Child>,
  restarts: u32,
  last_ok: Option<Instant>,
  last_error: Option<String>,
}

fn python_candidates() -> Vec<&'static str> {
  if cfg!(windows) {
    vec!["python", "py", "python3"]
  } else {
    vec!["python3", "python"]
  }
}

fn spawn_engine() -> Result<Child, String> {
  let mut last_err = String::from("no Python interpreter found");
  for bin in python_candidates() {
    match Command::new(bin)
      .args([
        "-m",
        "neiro.cli",
        "ui",
        "--no-browser",
        "--port",
        &PORT.to_string(),
      ])
      .stdout(Stdio::null())
      .stderr(Stdio::piped())
      .spawn()
    {
      Ok(child) => return Ok(child),
      Err(e) => last_err = format!("{bin}: {e}"),
    }
  }
  Err(last_err)
}

fn http_probe(path: &str, timeout: Duration) -> bool {
  let start = Instant::now();
  while start.elapsed() < timeout {
    if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", PORT)) {
      let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
      let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));
      let req = format!(
        "GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
      );
      if stream.write_all(req.as_bytes()).is_ok() {
        let mut buf = [0u8; 64];
        if let Ok(n) = stream.read(&mut buf) {
          let head = String::from_utf8_lossy(&buf[..n]);
          if head.contains("200") || head.starts_with("HTTP/1.") {
            return true;
          }
        }
      }
    }
    thread::sleep(Duration::from_millis(200));
  }
  false
}

fn wait_for_engine(timeout: Duration) -> bool {
  http_probe(HEALTH_PATH, timeout) || http_probe("/", timeout)
}

fn stop_engine(child: &mut Child) {
  let _ = child.kill();
  let _ = child.wait();
}

fn restart_engine(state: &mut EngineState) -> Result<(), String> {
  if let Some(mut child) = state.child.take() {
    stop_engine(&mut child);
  }
  let child = spawn_engine()?;
  state.child = Some(child);
  state.restarts += 1;
  if !wait_for_engine(Duration::from_secs(30)) {
    let msg = "engine did not become ready after restart".to_string();
    state.last_error = Some(msg.clone());
    return Err(msg);
  }
  state.last_ok = Some(Instant::now());
  state.last_error = None;
  Ok(())
}

fn spawn_health_supervisor(app: AppHandle) {
  thread::spawn(move || {
    loop {
      thread::sleep(Duration::from_secs(5));
      let healthy = http_probe(HEALTH_PATH, Duration::from_millis(800));
      let Some(state) = app.try_state::<EngineProcess>() else {
        break;
      };
      let Ok(mut guard) = state.0.lock() else {
        continue;
      };
      if healthy {
        guard.last_ok = Some(Instant::now());
        guard.last_error = None;
        continue;
      }
      // Child exited or health failed — restart with backoff
      if let Some(child) = guard.child.as_mut() {
        if let Ok(Some(status)) = child.try_wait() {
          guard.last_error = Some(format!("engine exited: {status}"));
        } else {
          guard.last_error = Some("engine health probe failed".into());
        }
      }
      if guard.restarts > 20 {
        continue;
      }
      let _ = restart_engine(&mut guard);
    }
  });
}

#[tauri::command]
fn engine_status(state: State<'_, EngineProcess>) -> serde_json::Value {
  let guard = state.0.lock().expect("engine lock");
  serde_json::json!({
    "url": ENGINE_URL,
    "restarts": guard.restarts,
    "last_ok_secs_ago": guard.last_ok.map(|t| t.elapsed().as_secs()),
    "last_error": guard.last_error,
    "running": guard.child.is_some(),
  })
}

#[tauri::command]
fn restart_engine_cmd(state: State<'_, EngineProcess>) -> Result<String, String> {
  let mut guard = state.0.lock().map_err(|e| e.to_string())?;
  restart_engine(&mut guard)?;
  Ok("restarted".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let engine = EngineProcess(Mutex::new(EngineState {
    child: None,
    restarts: 0,
    last_ok: None,
    last_error: None,
  }));

  tauri::Builder::default()
    .manage(engine)
    .invoke_handler(tauri::generate_handler![engine_status, restart_engine_cmd])
    .setup(|app| {
      let handle = app.handle().clone();
      {
        let state = handle.state::<EngineProcess>();
        let mut guard = state.0.lock().expect("engine lock");
        restart_engine(&mut guard).map_err(|e| {
          format!("Could not start Neiro engine ({e}). Is Neiro installed in this Python?")
        })?;
      }
      if cfg!(debug_assertions) {
        handle.plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      spawn_health_supervisor(handle.clone());
      let _ = ENGINE_URL;
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building Neiro")
    .run(|app_handle, event| {
      if let RunEvent::Exit = event {
        if let Some(state) = app_handle.try_state::<EngineProcess>() {
          if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.child.take() {
              stop_engine(&mut child);
            }
          }
        }
      }
    });
}
