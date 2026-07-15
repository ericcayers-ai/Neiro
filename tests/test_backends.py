from neiro.engine.backends import probe_backends, should_compile


def test_probe_backends_includes_cpu():
    ladder = probe_backends()
    ids = [b.id for b in ladder.backends]
    assert "cpu" in ids
    pref = ladder.preferred()
    assert pref.available


def test_should_compile_does_not_raise():
    assert isinstance(should_compile(), bool)
