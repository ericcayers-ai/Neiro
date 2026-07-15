from pathlib import Path

pairs = [
    (Path("pyproject.toml"), 'version = "0.4.0"', 'version = "1.0.0"'),
    (Path("src/neiro/__init__.py"), '__version__ = "0.4.0"', '__version__ = "1.0.0"'),
    (Path("package.json"), '"version": "0.4.0"', '"version": "1.0.0"'),
    (Path("frontend/package.json"), '"version": "0.0.0"', '"version": "1.0.0"'),
    (Path("src-tauri/Cargo.toml"), 'version = "0.4.0"', 'version = "1.0.0"'),
    (Path("src-tauri/tauri.conf.json"), '"version": "0.4.0"', '"version": "1.0.0"'),
]
for path, old, new in pairs:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        # already bumped?
        if new in text:
            print("already", path)
        else:
            print("MISS", path)
        continue
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("OK", path)
