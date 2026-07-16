from neiro.symbolic.lyric_align import align_reference_lyrics


def test_align_reference_lyrics_matches_in_order():
    ref = "hello world from neiro"
    hyps = [
        ("Hello", 0.0, 0.3),
        ("world", 0.3, 0.6),
        ("from", 0.6, 0.9),
        ("Neiro", 0.9, 1.2),
    ]
    aligned = align_reference_lyrics(ref, hyps)
    assert [a.text for a in aligned] == ["hello", "world", "from", "neiro"]
    assert all(a.matched for a in aligned)
    assert aligned[0].onset == 0.0
    assert aligned[-1].offset == 1.2
