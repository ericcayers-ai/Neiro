use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const ENGINE_HOST: &str = "127.0.0.1:8377";

pub fn post_json(path: &str, payload: &str) -> Result<(), String> {
    let mut stream = TcpStream::connect(ENGINE_HOST).map_err(|err| err.to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let req = format!(
        "POST {path} HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|err| err.to_string())?;
    let mut buf = [0u8; 256];
    let _ = stream.read(&mut buf);
    Ok(())
}

pub fn json_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn register_instance(instance_id: &str, host: &str, sample_rate: u32) -> Result<(), String> {
    let body = format!(
        r#"{{"instance_id":"{}","track_name":"Neiro CLAP bridge","plugin_role":"injector","host":"{}","sample_rate":{},"channels":2,"preferred_module":"learn"}}"#,
        json_escape(instance_id),
        json_escape(host),
        sample_rate
    );
    post_json("/api/daw/register", &body)
}

pub fn show_ui(instance_id: &str, module: &str) -> Result<(), String> {
    let body = format!(
        r#"{{"instance_id":"{}","module":"{}","launch_if_needed":true}}"#,
        json_escape(instance_id),
        json_escape(module)
    );
    post_json("/api/daw/show-ui", &body)
}

pub fn heartbeat(instance_id: &str, peak: f32, frames: u32, recording: bool) -> Result<(), String> {
    let body = format!(
        r#"{{"instance_id":"{}","peak":{:.6},"frames":{},"recording":{},"preferred_module":"learn"}}"#,
        json_escape(instance_id),
        peak,
        frames,
        if recording { "true" } else { "false" }
    );
    post_json("/api/daw/heartbeat", &body)
}
