const CONFIG = window.RADIO_CONFIG || {}

const RADIO_NAME = CONFIG.RADIO_NAME || "The Sound Station"
const URL_STREAMING = CONFIG.URL_STREAMING || "https://sound-station.volticast.net/primary"

const API_URL = CONFIG.API_URL || "https://api.twj.es/?url=" + URL_STREAMING
const FALLBACK_API_URL = CONFIG.FALLBACK_API_URL || "https://api.twj.es/metadata/?url=" + URL_STREAMING

if (CONFIG.ACCENT_COLOR) {
    document.documentElement.style.setProperty("--accent", CONFIG.ACCENT_COLOR)
}

if (CONFIG.BG_COLOR) {
    document.documentElement.style.setProperty("--bg", CONFIG.BG_COLOR)
}

let musicaAtual = null
let audio = new Audio(URL_STREAMING)

let isIntentionalPause = true
let reconnectAttempts = 0
let reconnectTimeout = null
let fadeInterval = null

const cache = {}
const lyricsCache = {}
const nowPlayingArtCache = {}

let clipTrack = null
let lastClipShownId = null
let clipWasRadioPlaying = false
let historyClipActive = false
const clipPlayingSet = new Set()

function normalizeText(text) {
    return (text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
}

function intToDecimal(value) {
    return Number(value) / 100
}

function decimalToInt(value) {
    return Math.round(Number(value) * 100)
}

function changeImageSize(url, size) {
    const parts = url.split("/")
    const filename = parts.pop()
    const extension = filename.substring(filename.lastIndexOf("."))
    return parts.join("/") + "/" + size + extension
}

class Page {
    changeTitlePage(title = RADIO_NAME) {
        document.title = title
    }

    changeVolumeIndicator(volume) {
        const indicator = document.getElementById("volIndicator")

        if (indicator) {
            indicator.textContent = volume
        }

        localStorage.setItem("volume", volume)
    }

    setVolume() {
        const slider = document.getElementById("volume")
        const indicator = document.getElementById("volIndicator")

        if (!slider) return

        const savedVolume = localStorage.getItem("volume") || 80

        slider.value = savedVolume

        if (indicator) {
            indicator.textContent = savedVolume
        }

        audio.volume = intToDecimal(savedVolume)
    }

    refreshCurrentSong(song, artist) {
        const currentSong = document.getElementById("currentSong")
        const currentArtist = document.getElementById("currentArtist")
        const lyricsSong = document.getElementById("lyricsSong")

        if (!currentSong || !currentArtist) return

        if (
            currentSong.textContent === song &&
            currentArtist.textContent === artist
        ) {
            return
        }

        currentSong.classList.add("fade-out")
        currentArtist.classList.add("fade-out")

        setTimeout(function () {
            currentSong.textContent = song
            currentArtist.textContent = artist

            if (lyricsSong) {
                lyricsSong.textContent = song + " - " + artist
            }

            currentSong.classList.remove("fade-out")
            currentArtist.classList.remove("fade-out")

            currentSong.classList.add("fade-in")
            currentArtist.classList.add("fade-in")

            setTimeout(function () {
                currentSong.classList.remove("fade-in")
                currentArtist.classList.remove("fade-in")
            }, 500)
        }, 300)
    }

    async refreshCover(song, artist, apiArt = null) {
        const coverArt = document.getElementById("currentCoverArt")
        const background = document.getElementById("bgCover")
        const defaultCover = "img/cover.png"

        if (!coverArt || !background) return

        try {
            let art = defaultCover
            let cover = defaultCover

            if (apiArt) {
                art = apiArt
                cover = apiArt.replace("600x600", "1500x1500")
            } else {
                const data = await getCoverData(
                    artist,
                    song,
                    defaultCover,
                    defaultCover
                )

                art = data.art
                cover = data.cover
            }

            coverArt.style.backgroundImage = "url('" + art + "')"
            background.style.backgroundImage = "url('" + cover + "')"

            if (art !== defaultCover) {
                const key =
                    normalizeText(artist) +
                    "|" +
                    normalizeText(song)

                nowPlayingArtCache[key] = {
                    art: art,
                    cover: cover,
                    thumbnail: art
                }
            }

            coverArt.classList.add("animated", "bounceInLeft")

            setTimeout(function () {
                coverArt.classList.remove("animated", "bounceInLeft")
            }, 2000)

            if ("mediaSession" in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: song,
                    artist: artist,
                    artwork: [
                        {
                            src: art,
                            sizes: "512x512",
                            type: "image/png"
                        }
                    ]
                })
            }
        } catch (error) {
            console.log("Cover error:", error)
        }
    }

    async refreshHistoric(info, article) {
        const cover = article.querySelector(".cover-historic")

        if (!cover) return

        const song =
            typeof info.song === "object"
                ? info.song.title
                : info.song

        const artist =
            typeof info.artist === "object"
                ? info.artist.title
                : info.artist

        const defaultCover = "img/cover.png"

        try {
            const key =
                normalizeText(artist) +
                "|" +
                normalizeText(song)

            const data =
                nowPlayingArtCache[key] ||
                await getCoverData(
                    artist,
                    song,
                    defaultCover,
                    defaultCover
                )

            cover.style.backgroundImage =
                "url('" +
                (data.thumbnail || data.art || defaultCover) +
                "')"
        } catch (error) {
            cover.style.backgroundImage =
                "url('" + defaultCover + "')"
        }
    }
}

async function fetchLyrics(artist, song) {
    const key =
        normalizeText(artist) +
        " - " +
        normalizeText(song)

    if (lyricsCache[key]) {
        return lyricsCache[key]
    }

    const request = (async function () {
        try {
            const response = await fetch(
                "https://api.lyrics.ovh/v1/" +
                encodeURIComponent(artist) +
                "/" +
                encodeURIComponent(song)
            )

            if (response.ok) {
                const data = await response.json()

                if (data.lyrics) {
                    return data.lyrics
                }
            }
        } catch (error) {}

        try {
            const response = await fetch(
                "https://lrclib.net/api/get?artist_name=" +
                encodeURIComponent(artist) +
                "&track_name=" +
                encodeURIComponent(song)
            )

            if (response.ok) {
                const data = await response.json()

                if (data.plainLyrics) {
                    return data.plainLyrics
                }

                if (data.syncedLyrics) {
                    return data.syncedLyrics
                }
            }
        } catch (error) {}

        try {
            const response = await fetch(
                "https://lrclib.net/api/search?track_name=" +
                encodeURIComponent(song) +
                "&artist_name=" +
                encodeURIComponent(artist)
            )

            if (response.ok) {
                const results = await response.json()

                if (Array.isArray(results)) {
                    const result = results.find(function (item) {
                        return item.plainLyrics || item.syncedLyrics
                    })

                    if (result) {
                        return result.plainLyrics || result.syncedLyrics
                    }
                }
            }
        } catch (error) {}

        return null
    })()

    lyricsCache[key] = request

    return request
}

async function getCoverData(artist, title, defaultArt, defaultCover) {
    const search = await getDataFromSearch(
        artist,
        title,
        defaultArt,
        defaultCover
    )

    if (search) {
        return search
    }

    return getDataFromITunes(
        artist,
        title,
        defaultArt,
        defaultCover
    )
}

async function getDataFromSearch(
    artist,
    title,
    defaultArt,
    defaultCover
) {
    const text =
        artist === title
            ? title
            : artist + " - " + title

    const key = "search:" + text.toLowerCase()

    if (cache[key]) {
        return cache[key]
    }

    try {
        const response = await fetch(
            "https://api.twj.es/search.php?query=" +
            encodeURIComponent(text)
        )

        if (!response.ok) {
            return null
        }

        const data = await response.json()

        if (data.results && data.results.artwork) {
            const result = {
                title: title,
                artist: artist,
                thumbnail: data.results.artwork,
                art: data.results.artwork,
                cover: data.results.artwork,
                stream_url: data.results.stream_url || ""
            }

            cache[key] = result

            return result
        }
    } catch (error) {}

    return null
}

async function getDataFromITunes(
    artist,
    title,
    defaultArt,
    defaultCover
) {
    const text =
        artist === title
            ? title
            : artist + " " + title

    const key = "itunes:" + text.toLowerCase()

    if (cache[key]) {
        return cache[key]
    }

    try {
        const response = await fetch(
            "https://itunes.apple.com/search?limit=1&media=music&entity=song&term=" +
            encodeURIComponent(text)
        )

        if (!response.ok) {
            return {
                title: title,
                artist: artist,
                art: defaultArt,
                cover: defaultCover
            }
        }

        const data = await response.json()

        if (!data.results || !data.results.length) {
            return {
                title: title,
                artist: artist,
                art: defaultArt,
                cover: defaultCover
            }
        }

        const item = data.results[0]

        const result = {
            title: title,
            artist: artist,
            thumbnail: item.artworkUrl100 || defaultArt,
            art: item.artworkUrl100
                ? changeImageSize(item.artworkUrl100, "600x600")
                : defaultArt,
            cover: item.artworkUrl100
                ? changeImageSize(item.artworkUrl100, "1500x1500")
                : defaultCover
        }

        cache[key] = result

        return result
    } catch (error) {
        return {
            title: title,
            artist: artist,
            art: defaultArt,
            cover: defaultCover
        }
    }
}

async function fetchStreamingData(url) {
    try {
        const response = await fetch(url)

        if (!response.ok) {
            throw new Error("API error")
        }

        return await response.json()
    } catch (error) {
        console.log("Streaming API error:", error)
        return null
    }
}

async function getStreamingData() {
    try {
        let data = await fetchStreamingData(API_URL)

        if (!data) {
            data = await fetchStreamingData(FALLBACK_API_URL)
        }

        if (!data) return

        if (
            data.loading ||
            (!data.artist &&
                /^carregando/i.test(data.songtitle || ""))
        ) {
            const song = document.getElementById("currentSong")
            const artist = document.getElementById("currentArtist")

            if (song) song.textContent = "Loading..."
            if (artist) artist.textContent = RADIO_NAME

            return
        }

        let song =
            data.songtitle ||
            (typeof data.song === "object"
                ? data.song.title
                : data.song) ||
            ""

        let artist =
            typeof data.artist === "object"
                ? data.artist.title
                : data.artist || ""

        if (song.includes(" - ")) {
            const parts = song.split(" - ")
            const embeddedArtist = parts.shift().trim()
            const embeddedTitle = parts.join(" - ").trim()

            if (!artist) {
                artist = embeddedArtist
                song = embeddedTitle
            } else if (
                normalizeText(embeddedArtist) ===
                normalizeText(artist)
            ) {
                song = embeddedTitle
            }
        }

        const songKey =
            normalizeText(artist) +
            "|" +
            normalizeText(song)

        if (songKey !== musicaAtual) {
            const page = new Page()

            document.title =
                song +
                " - " +
                artist +
                " | " +
                RADIO_NAME

            page.refreshCurrentSong(song, artist)

            page.refreshCover(
                song,
                artist,
                data.albumArt || data.art || null
            )

            updateLyricsButton(song, artist)
            updateHistory(data, song, artist)

            musicaAtual = songKey
        }

        handleClipTrack(
            data,
            song,
            artist
        )
    } catch (error) {
        console.log("Now playing error:", error)
    }
}

function updateLyricsButton(song, artist) {
    const button = document.querySelector(".lyrics")

    if (!button) return

    if (
        !song ||
        !artist ||
        song === "Song Title" ||
        artist === "Artist Name"
    ) {
        button.style.opacity = "0.3"
        button.disabled = true
        return
    }

    button.style.opacity = "1"
    button.disabled = false
}

async function updateHistory(data, currentSong, currentArtist) {
    const container = document.getElementById("historicSong")

    if (!container) return

    container.innerHTML = ""

    const history =
        data.song_history
            ? data.song_history.map(function (item) {
                return {
                    song: item.song.title,
                    artist: item.song.artist,
                    youtubeId: item.song.youtubeId || ""
                }
            })
            : data.history || []

    const currentSongNorm = normalizeText(currentSong)
    const currentArtistNorm = normalizeText(currentArtist)

    const pastSongs = history.filter(function (item) {
        const song =
            typeof item.song === "object"
                ? item.song.title
                : item.song

        const artist =
            typeof item.artist === "object"
                ? item.artist.title
                : item.artist

        return !(
            normalizeText(artist) === currentArtistNorm &&
            (
                normalizeText(song) === currentSongNorm ||
                normalizeText(song).startsWith(currentSongNorm) ||
                currentSongNorm.startsWith(normalizeText(song))
            )
        )
    })

    const songs = pastSongs.slice(0, 4)

    for (const item of songs) {
        const article = document.createElement("article")

        article.classList.add(
            "animated",
            "slideInRight"
        )

        article.innerHTML = `
            <div class="cover-historic"></div>
            <div class="music-info">
                <div class="song"></div>
                <div class="artist"></div>
            </div>
        `

        article.querySelector(".song").textContent =
            item.song || "Unknown"

        article.querySelector(".artist").textContent =
            item.artist || "Unknown"

        if (item.youtubeId) {
            article.classList.add("has-clip")

            article.addEventListener("click", function () {
                playHistoryClip(item)
            })
        }

        container.appendChild(article)

        const page = new Page()

        page.refreshHistoric(item, article)

        setTimeout(function () {
            article.classList.remove(
                "animated",
                "slideInRight"
            )
        }, 2000)
    }
}

function openLyrics() {
    const modal = document.getElementById("modalLyrics")
    const lyricBox = document.getElementById("lyric")

    const songElement = document.getElementById("currentSong")
    const artistElement = document.getElementById("currentArtist")

    if (!modal || !lyricBox || !songElement || !artistElement) {
        return
    }

    const song = songElement.textContent.trim()
    const artist = artistElement.textContent.trim()

    if (!song || !artist) return

    modal.style.display = "flex"
    modal.setAttribute("aria-hidden", "false")

    document.body.classList.add("modal-open")

    lyricBox.textContent = "Loading lyrics..."

    fetchLyrics(artist, song).then(function (lyrics) {
        if (lyrics) {
            lyricBox.innerHTML = lyrics.replace(
                /\n/g,
                "<br>"
            )
        } else {
            lyricBox.textContent =
                "Lyrics could not be found for this song."
        }
    })
}

function closeLyrics() {
    const modal = document.getElementById("modalLyrics")

    if (!modal) return

    modal.style.display = "none"
    modal.setAttribute("aria-hidden", "true")

    document.body.classList.remove("modal-open")
}

function setupControls() {
    const volumeButton =
        document.querySelector(".volume-toggle")

    const volumePopover =
        document.querySelector(".volume-popover")

    const volumeSlider =
        document.getElementById("volume")

    const lyricsButton =
        document.querySelector(".lyrics")

    const closeButton =
        document.querySelector(".modal-close")

    const modal =
        document.getElementById("modalLyrics")

    if (volumeButton && volumePopover) {
        volumeButton.addEventListener("click", function (event) {
            event.stopPropagation()

            volumePopover.hidden =
                !volumePopover.hidden
        })
    }

    if (volumeSlider) {
        volumeSlider.addEventListener("input", function () {
            const value = Number(this.value)

            audio.volume = value / 100

            const indicator =
                document.getElementById("volIndicator")

            if (indicator) {
                indicator.textContent = value
            }

            localStorage.setItem(
                "volume",
                value
            )

            updateVolumeIcon(value)
        })
    }

    if (lyricsButton) {
        lyricsButton.addEventListener(
            "click",
            openLyrics
        )
    }

    if (closeButton) {
        closeButton.addEventListener(
            "click",
            closeLyrics
        )
    }

    if (modal) {
        modal.addEventListener(
            "click",
            function (event) {
                if (event.target === modal) {
                    closeLyrics()
                }
            }
        )
    }

    document.addEventListener(
        "click",
        function (event) {
            if (
                volumePopover &&
                volumeButton &&
                !volumePopover.contains(event.target) &&
                !volumeButton.contains(event.target)
            ) {
                volumePopover.hidden = true
            }
        }
    )
}

function updateVolumeIcon(value) {
    const button =
        document.querySelector(".volume-toggle")

    if (!button) return

    const icon = button.querySelector("i")

    if (!icon) return

    if (value === 0) {
        icon.className = "fa fa-volume-off"
    } else if (value < 50) {
        icon.className = "fa fa-volume-down"
    } else {
        icon.className = "fa fa-volume-up"
    }
}

function setPlayerIcon(icon, label) {
    const button =
        document.getElementById("playerButton")

    const labelElement =
        document.getElementById("buttonPlay")

    if (button) {
        button.className = icon
    }

    if (labelElement) {
        labelElement.textContent = label
    }
}

function fadeOut(callback) {
    if (fadeInterval) {
        clearInterval(fadeInterval)
    }

    const current = audio.volume
    const step = current / 15

    if (step <= 0) {
        callback()
        return
    }

    fadeInterval = setInterval(function () {
        audio.volume -= step

        if (audio.volume <= 0.01) {
            audio.volume = 0

            clearInterval(fadeInterval)
            fadeInterval = null

            if (callback) {
                callback()
            }
        }
    }, 30)
}

function fadeIn() {
    if (fadeInterval) {
        clearInterval(fadeInterval)
    }

    const saved =
        Number(
            localStorage.getItem("volume") ||
            document.getElementById("volume")?.value ||
            80
        ) / 100

    audio.volume = 0

    const step = saved / 15

    if (step <= 0) {
        audio.volume = saved
        return
    }

    fadeInterval = setInterval(function () {
        audio.volume += step

        if (audio.volume >= saved) {
            audio.volume = saved

            clearInterval(fadeInterval)
            fadeInterval = null
        }
    }, 30)
}

function togglePlay() {
    if (!audio.paused) {
        isIntentionalPause = true

        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout)
        }

        fadeOut(function () {
            audio.pause()
        })

        return
    }

    pauseYouTubeEmbeds()

    exitClipMode()

    isIntentionalPause = false

    fadeIn()

    audio.load()

    audio.play().catch(function () {
        setPlayerIcon(
            "fa fa-play",
            "PLAY"
        )
    })
}

function pauseYouTubeEmbeds() {
    document
        .querySelectorAll('iframe[src*="youtube"]')
        .forEach(function (frame) {
            try {
                frame.contentWindow.postMessage(
                    JSON.stringify({
                        event: "command",
                        func: "pauseVideo",
                        args: []
                    }),
                    "*"
                )
            } catch (error) {}
        })
}

function volumeUp() {
    const value = Math.min(
        1,
        audio.volume + 0.01
    )

    audio.volume = value

    const number = decimalToInt(value)

    const slider =
        document.getElementById("volume")

    if (slider) {
        slider.value = number
    }

    new Page().changeVolumeIndicator(number)

    updateVolumeIcon(number)
}

function volumeDown() {
    const value = Math.max(
        0,
        audio.volume - 0.01
    )

    audio.volume = value

    const number = decimalToInt(value)

    const slider =
        document.getElementById("volume")

    if (slider) {
        slider.value = number
    }

    new Page().changeVolumeIndicator(number)

    updateVolumeIcon(number)
}

function mute() {
    if (!audio.muted && audio.volume > 0) {
        localStorage.setItem(
            "volume",
            decimalToInt(audio.volume)
        )

        audio.volume = 0
        audio.muted = true

        const slider =
            document.getElementById("volume")

        if (slider) {
            slider.value = 0
        }

        new Page().changeVolumeIndicator(0)

        updateVolumeIcon(0)
    } else {
        const volume =
            Number(
                localStorage.getItem("volume") || 80
            )

        audio.muted = false
        audio.volume = volume / 100

        const slider =
            document.getElementById("volume")

        if (slider) {
            slider.value = volume
        }

        new Page().changeVolumeIndicator(volume)

        updateVolumeIcon(volume)
    }
}

audio.addEventListener("play", function () {
    setPlayerIcon(
        "fa fa-pause",
        "PAUSE"
    )
})

audio.addEventListener("pause", function () {
    if (!isIntentionalPause) return

    setPlayerIcon(
        "fa fa-play",
        "PLAY"
    )
})

audio.addEventListener("waiting", function () {
    if (!audio.paused) {
        setPlayerIcon(
            "fa fa-spinner fa-spin",
            "LOADING"
        )
    }
})

audio.addEventListener("playing", function () {
    isIntentionalPause = false
    reconnectAttempts = 0

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
        reconnectTimeout = null
    }

    setPlayerIcon(
        "fa fa-pause",
        "PAUSE"
    )
})

audio.addEventListener("stalled", handleConnectionDrop)
audio.addEventListener("error", handleConnectionDrop)

function handleConnectionDrop() {
    if (isIntentionalPause) return

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
    }

    if (reconnectAttempts < 5) {
        reconnectAttempts++

        setPlayerIcon(
            "fa fa-spinner fa-spin",
            "RECONNECTING"
        )

        reconnectTimeout = setTimeout(function () {
            audio.load()

            audio.play().catch(function () {})
        }, reconnectAttempts * 2000)
    } else {
        reconnectAttempts = 0

        setPlayerIcon(
            "fa fa-play",
            "PLAY"
        )
    }
}

function clipModeOn() {
    return localStorage.getItem("clipMode") === "1"
}

function handleClipTrack(data, song, artist) {
    const youtubeId =
        data.youtubeId ||
        data.youtube_id ||
        ""

    const nowPlaying =
        data.now_playing || {}

    clipTrack = youtubeId
        ? {
            id: youtubeId,
            song: song,
            artist: artist,
            elapsed: nowPlaying.elapsed || 0,
            duration: nowPlaying.duration || 0,
            receivedAt: Date.now()
        }
        : null

    const button =
        document.querySelector(".clip-toggle")

    if (button) {
        button.hidden = !youtubeId
    }

    if (historyClipActive) return

    if (!clipModeOn()) return

    if (clipTrack) {
        openClip(clipTrack)
    } else {
        closeClip(true)
    }
}

function openClip(track) {
    if (lastClipShownId === track.id) return

    lastClipShownId = track.id

    const cover =
        document.querySelector(".cover-album")

    if (!cover) return

    if (!audio.paused) {
        clipWasRadioPlaying = true
        isIntentionalPause = true

        fadeOut(function () {
            audio.pause()
        })
    }

    let start = 0

    if (track.elapsed) {
        start = Math.floor(
            track.elapsed +
            (Date.now() - track.receivedAt) / 1000
        )

        if (
            track.duration &&
            start >= track.duration - 5
        ) {
            start = 0
        }

        if (start < 8) {
            start = 0
        }
    }

    cover.classList.add("is-clip")

    const oldFrame =
        cover.querySelector(".clip-frame")

    if (oldFrame) {
        oldFrame.remove()
    }

    const iframe =
        document.createElement("iframe")

    iframe.className = "clip-frame"

    iframe.src =
        "https://www.youtube-nocookie.com/embed/" +
        track.id +
        "?autoplay=1&enablejsapi=1" +
        (start ? "&start=" + start : "")

    iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"

    iframe.allowFullscreen = true

    iframe.title =
        "Music video: " +
        (track.song || "")

    iframe.addEventListener(
        "load",
        function () {
            iframe.contentWindow.postMessage(
                JSON.stringify({
                    event: "listening",
                    id: "clip",
                    channel: "widget"
                }),
                "*"
            )
        }
    )

    cover.appendChild(iframe)
}

function closeClip(resumeRadio) {
    const cover =
        document.querySelector(".cover-album")

    if (cover) {
        cover.classList.remove("is-clip")

        const iframe =
            cover.querySelector(".clip-frame")

        if (iframe) {
            iframe.remove()
        }
    }

    lastClipShownId = null
    historyClipActive = false
    clipPlayingSet.clear()

    if (
        resumeRadio &&
        clipWasRadioPlaying &&
        audio.paused
    ) {
        isIntentionalPause = false

        audio.load()

        audio.play().catch(function () {})
    }

    clipWasRadioPlaying = false
}

function exitClipMode() {
    if (!clipModeOn()) return

    localStorage.setItem(
        "clipMode",
        "0"
    )

    const button =
        document.querySelector(".clip-toggle")

    if (button) {
        button.classList.remove("is-active")
    }

    closeClip(false)
}

function playHistoryClip(songInfo) {
    historyClipActive = true

    openClip({
        id: songInfo.youtubeId,
        song: songInfo.song,
        artist: songInfo.artist,
        elapsed: 0,
        duration: 0,
        receivedAt: Date.now()
    })

    const cover =
        document.querySelector(".cover-album")

    if (cover) {
        cover.scrollIntoView({
            behavior: "smooth",
            block: "center"
        })
    }
}

window.addEventListener(
    "message",
    function (event) {
        let host = ""

        try {
            host = new URL(
                event.origin
            ).hostname
        } catch (error) {
            return
        }

        if (
            !/(^|\.)youtube(-nocookie)?\.com$/.test(host)
        ) {
            return
        }

        let data

        try {
            data = JSON.parse(event.data)
        } catch (error) {
            return
        }

        const state =
            data &&
            data.info &&
            typeof data.info.playerState === "number"
                ? data.info.playerState
                : null

        if (state === null) return

        const id =
            data.id || "clip"

        if (state === 1) {
            clipPlayingSet.add(id)

            if (!audio.paused) {
                clipWasRadioPlaying = true
                isIntentionalPause = true

                audio.pause()
            }
        }

        if (state === 2 || state === 0) {
            clipPlayingSet.delete(id)

            if (
                state === 0 &&
                historyClipActive &&
                clipModeOn() &&
                clipTrack
            ) {
                historyClipActive = false
                openClip(clipTrack)
                return
            }

            historyClipActive = false

            if (
                clipPlayingSet.size === 0 &&
                clipWasRadioPlaying &&
                audio.paused
            ) {
                isIntentionalPause = false

                audio.load()

                audio.play().catch(function () {})
            }

            if (state === 2) {
                exitClipMode()
            }

            if (
                (state === 2 || state === 0) &&
                !clipModeOn()
            ) {
                closeClip(false)
            }
        }
    }
)

function setupClipButton() {
    const button =
        document.querySelector(".clip-toggle")

    if (!button) return

    button.classList.toggle(
        "is-active",
        clipModeOn()
    )

    button.addEventListener(
        "click",
        function () {
            const enabled =
                !clipModeOn()

            localStorage.setItem(
                "clipMode",
                enabled ? "1" : "0"
            )

            button.classList.toggle(
                "is-active",
                enabled
            )

            if (enabled && clipTrack) {
                openClip(clipTrack)
            } else if (!enabled) {
                closeClip(true)
            }
        }
    )
}

document.addEventListener(
    "keydown",
    function (event) {
        const slider =
            document.getElementById("volume")

        switch (event.key) {
            case "ArrowUp":
                volumeUp()
                break

            case "ArrowDown":
                volumeDown()
                break

            case " ":
            case "Spacebar":
                event.preventDefault()
                togglePlay()
                break

            case "p":
            case "P":
                togglePlay()
                break

            case "m":
            case "M":
                mute()
                break

            default:
                if (
                    /^[0-9]$/.test(event.key)
                ) {
                    const value =
                        Number(event.key) * 10

                    audio.volume =
                        value / 100

                    if (slider) {
                        slider.value = value
                    }

                    new Page()
                        .changeVolumeIndicator(value)

                    updateVolumeIcon(value)
                }
        }
    }
)

let deferredInstallPrompt = null

window.addEventListener(
    "beforeinstallprompt",
    function (event) {
        event.preventDefault()

        deferredInstallPrompt = event

        const button =
            document.getElementById(
                "installPwaBtn"
            )

        if (button) {
            button.hidden = false
        }
    }
)

window.addEventListener(
    "appinstalled",
    function () {
        const button =
            document.getElementById(
                "installPwaBtn"
            )

        if (button) {
            button.hidden = true
        }

        deferredInstallPrompt = null
    }
)

function setupInstallButton() {
    const button =
        document.getElementById(
            "installPwaBtn"
        )

    if (!button) return

    button.addEventListener(
        "click",
        async function () {
            if (!deferredInstallPrompt) return

            deferredInstallPrompt.prompt()

            await deferredInstallPrompt.userChoice

            deferredInstallPrompt = null
            button.hidden = true
        }
    )
}

document.querySelector(".popout-btn").addEventListener("click", () => {
    window.open(
        window.location.href,
        "SoundStationPlayer",
        "width=450,height=700,resizable=yes"
    );
});

document.addEventListener("DOMContentLoaded", () => {
    const discordBtn = document.querySelector(".discord-btn");

    if (discordBtn) {
        discordBtn.addEventListener("click", () => {
            window.open(
                "https://discord.gg/njVgKx9m9C",
                "_blank",
                "noopener,noreferrer"
            );
        });
    }
});

window.addEventListener(
    "load",
    function () {
        const page = new Page()

        page.changeTitlePage()
        page.setVolume()

        const radioName =
            document.getElementById("radioName")

        if (radioName) {
            radioName.textContent =
                RADIO_NAME
        }

        setupControls()
        setupClipButton()
        setupInstallButton()

        getStreamingData()

        setInterval(
            getStreamingData,
            10000
        )

        audio.load()
    }
)
