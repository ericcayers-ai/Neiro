//! Neiro CLAP/VST3 bridge stub.
//!
//! The production DAW injector remains the VST2 crate in `plugins/neiro-vst`.
//! This crate keeps the CLAP/VST3 package path buildable while sharing the same
//! local HTTP bridge calls, so replacing the placeholder exports with a real
//! plugin SDK implementation does not require a new engine-side API.

mod http;

use std::ffi::CStr;
use std::os::raw::{c_char, c_int};
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};

static INSTANCE_COUNTER: AtomicU64 = AtomicU64::new(1);

fn cstr_or_default(ptr: *const c_char, default: &str) -> String {
    if ptr.is_null() {
        return default.to_string();
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_str()
        .unwrap_or(default)
        .to_string()
}

fn next_instance_id() -> String {
    let n = INSTANCE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("clap-{n:08x}")
}

#[no_mangle]
pub extern "C" fn neiro_clap_version() -> c_int {
    11_000
}

#[no_mangle]
pub extern "C" fn neiro_clap_register(
    instance_id: *const c_char,
    host: *const c_char,
    sample_rate: c_int,
) -> c_int {
    let id = cstr_or_default(instance_id, &next_instance_id());
    let host = cstr_or_default(host, "clap-vst3-host");
    match http::register_instance(&id, &host, sample_rate.max(1) as u32) {
        Ok(()) => 0,
        Err(_) => -1,
    }
}

#[no_mangle]
pub extern "C" fn neiro_clap_show_ui(instance_id: *const c_char, module: *const c_char) -> c_int {
    let id = cstr_or_default(instance_id, &next_instance_id());
    let module = cstr_or_default(module, "learn");
    match http::show_ui(&id, &module) {
        Ok(()) => 0,
        Err(_) => -1,
    }
}

#[no_mangle]
pub extern "C" fn neiro_clap_heartbeat(
    instance_id: *const c_char,
    peak: f32,
    frames: c_int,
    recording: c_int,
) -> c_int {
    let id = cstr_or_default(instance_id, &next_instance_id());
    match http::heartbeat(&id, peak, frames.max(0) as u32, recording != 0) {
        Ok(()) => 0,
        Err(_) => -1,
    }
}

// VST3-shaped module exports. These are placeholders for hosts/build scripts to
// discover while the real VST3 factory is still out of scope for the MVP.
#[no_mangle]
pub extern "C" fn InitDll() -> bool {
    true
}

#[no_mangle]
pub extern "C" fn ExitDll() -> bool {
    true
}

#[no_mangle]
pub extern "C" fn GetPluginFactory() -> *const std::ffi::c_void {
    ptr::null()
}

// CLAP-shaped entry export placeholder. A real CLAP plugin will replace this
// with a populated `clap_plugin_entry` from a CLAP SDK binding.
#[no_mangle]
pub static clap_entry: usize = 0;

#[cfg(test)]
mod tests {
    use super::neiro_clap_version;

    #[test]
    fn version_is_1_1_series() {
        assert_eq!(neiro_clap_version(), 11_000);
    }
}
