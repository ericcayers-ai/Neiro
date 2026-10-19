/* Neiro Companion — site adapters (classic script, injected on demand). */
/* global window */
var NeiroAdapters = (function () {
  'use strict'

  var definitions = [
    {
      id: 'youtube',
      label: 'YouTube',
      hosts: ['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com', 'youtu.be'],
      media: function () {
        return (
          document.querySelector('video.html5-main-video') ||
          document.querySelector('video') ||
          document.querySelector('audio')
        )
      },
      title: function () {
        var node =
          document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
          document.querySelector('yt-formatted-string.title') ||
          document.querySelector('meta[name="title"]')
        return node ? (node.content || node.textContent || '').trim() : document.title
      },
      isAd: function () {
        return Boolean(document.querySelector('.ad-showing, .ytp-ad-player-overlay'))
      },
      direct: true,
    },
    {
      id: 'spotify',
      label: 'Spotify',
      hosts: ['open.spotify.com'],
      media: function () {
        return document.querySelector('audio') || document.querySelector('video')
      },
      title: function () {
        var node = document.querySelector('[data-testid="context-item-info-title"]')
        return node ? node.textContent.trim() : document.title
      },
      isAd: function () {
        return Boolean(document.querySelector('[data-testid="ad-banner"], [aria-label*="Advertisement"]'))
      },
      direct: true,
      note: 'Protected (EME) audio may not be capturable; pitch-only Tab Audio is the fallback.',
    },
    {
      id: 'soundcloud',
      label: 'SoundCloud',
      hosts: ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'],
      media: function () {
        return document.querySelector('audio') || document.querySelector('video')
      },
      title: function () {
        return (document.querySelector('.playbackSoundBadge__titleLink') || {}).textContent || document.title
      },
      isAd: function () {
        return Boolean(document.querySelector('.adContainer, .advertisement'))
      },
      direct: true,
    },
    {
      id: 'deezer',
      label: 'Deezer',
      hosts: ['deezer.com', 'www.deezer.com'],
      media: function () {
        return document.querySelector('audio') || document.querySelector('video')
      },
      title: function () {
        return document.title
      },
      isAd: function () {
        return Boolean(document.querySelector('.advertisement, [data-testid="ad"]'))
      },
      direct: true,
    },
    {
      id: 'apple-music',
      label: 'Apple Music',
      hosts: ['music.apple.com'],
      media: function () {
        return document.querySelector('audio') || document.querySelector('video')
      },
      title: function () {
        return document.title
      },
      isAd: function () {
        return false
      },
      direct: true,
      note: 'Apple Music web may use protected media; capture only what the browser permits.',
    },
    {
      id: 'tidal',
      label: 'Tidal',
      hosts: ['listen.tidal.com', 'tidal.com'],
      media: function () {
        return document.querySelector('audio') || document.querySelector('video')
      },
      title: function () {
        return document.title
      },
      isAd: function () {
        return false
      },
      direct: true,
    },
    {
      id: 'vimeo',
      label: 'Vimeo',
      hosts: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
      media: function () {
        return document.querySelector('video')
      },
      title: function () {
        return document.title
      },
      isAd: function () {
        return false
      },
      direct: true,
    },
    {
      id: 'generic',
      label: 'This page',
      hosts: [],
      media: function () {
        return document.querySelector('video') || document.querySelector('audio')
      },
      title: function () {
        return document.title
      },
      isAd: function () {
        return false
      },
      direct: false,
    },
  ]

  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase()
    } catch (error) {
      return ''
    }
  }

  function detect(url) {
    var host = hostOf(url || location.href)
    for (var i = 0; i < definitions.length; i += 1) {
      var adapter = definitions[i]
      for (var j = 0; j < adapter.hosts.length; j += 1) {
        if (host === adapter.hosts[j] || host.endsWith('.' + adapter.hosts[j])) {
          return adapter
        }
      }
    }
    return definitions[definitions.length - 1]
  }

  function media(adapter) {
    var element = adapter ? adapter.media() : null
    return element || null
  }

  function state(adapter) {
    var element = media(adapter)
    if (!element) {
      return { ok: false, reason: 'no-media', site: adapter ? adapter.id : 'generic' }
    }
    return {
      ok: true,
      site: adapter.id,
      label: adapter.label,
      title: adapter.title(),
      time: Number(element.currentTime) || 0,
      duration: Number(element.duration) || 0,
      paused: Boolean(element.paused),
      muted: Boolean(element.muted),
      ad: adapter.isAd(),
      hasMedia: true,
    }
  }

  function play(adapter) {
    var element = media(adapter)
    if (!element) return false
    var result = element.play()
    if (result && typeof result.catch === 'function') result.catch(function () {})
    return true
  }

  function pause(adapter) {
    var element = media(adapter)
    if (!element) return false
    element.pause()
    return true
  }

  function seek(adapter, seconds) {
    var element = media(adapter)
    if (!element) return false
    element.currentTime = Math.max(0, Number(seconds) || 0)
    return true
  }

  function setMuted(adapter, muted) {
    var element = media(adapter)
    if (!element) return false
    element.muted = Boolean(muted)
    return true
  }

  return {
    definitions: definitions,
    detect: detect,
    media: media,
    state: state,
    play: play,
    pause: pause,
    seek: seek,
    setMuted: setMuted,
  }
})()

if (typeof window !== 'undefined') {
  window.NeiroAdapters = NeiroAdapters
}
