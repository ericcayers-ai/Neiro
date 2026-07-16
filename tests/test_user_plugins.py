import json

from neiro.engine.registry import Registry
from neiro.engine.user_plugins import discover_plugins, register_user_plugins, save_grants


def _write_plugin(root, dirname, *, enabled=True, role="enhancer"):
    path = root / dirname
    path.mkdir(parents=True)
    (path / "plugin.json").write_text(
        json.dumps(
            {
                "name": "Example Plugin",
                "adapter": "example_plugin.adapter:ExampleAdapter",
                "role": role,
                "enabled": enabled,
            }
        ),
        encoding="utf-8",
    )
    return path


def test_user_plugin_scanner_requires_enabled_and_grant(tmp_path):
    plugins_dir = tmp_path / "plugins"
    _write_plugin(plugins_dir, "example")
    _write_plugin(plugins_dir, "disabled", enabled=False)

    plugins = discover_plugins(plugins_dir)
    assert [plugin.key for plugin in plugins] == ["disabled", "example"]
    assert not any(plugin.registerable for plugin in plugins)

    save_grants({"example": True, "disabled": True}, plugins_dir)
    plugins = {plugin.key: plugin for plugin in discover_plugins(plugins_dir)}
    assert plugins["example"].registerable
    assert not plugins["disabled"].registerable

    registry = Registry()
    assert register_user_plugins(registry, plugins_dir) == 1
    entry = registry.get("user-plugin-example")
    assert entry.task == "enhance"
    assert entry.manifest["adapter"] == "example_plugin.adapter:ExampleAdapter"
