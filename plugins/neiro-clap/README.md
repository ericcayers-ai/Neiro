# Neiro CLAP/VST3 bridge stub

This crate is the Neiro 1.1 CLAP/VST3 bridge starting point. It builds a shared
library with the same local HTTP bridge helpers used by the VST2 injector:

- register a DAW instance with `/api/daw/register`
- focus the shared Neiro window with `/api/daw/show-ui`
- send heartbeat telemetry with `/api/daw/heartbeat`

The exported CLAP/VST3 symbols are deliberately minimal placeholders so the
crate stays lightweight and buildable without adding a heavy plugin framework in
the MVP. Hosts should continue to use `plugins/neiro-vst` for the production DAW
injector until this crate is wired to a full CLAP/VST3 SDK.
