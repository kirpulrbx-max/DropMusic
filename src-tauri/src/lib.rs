#[cfg(desktop)]
mod visualizer;

// En celulares y TV no hay captura del audio del sistema: Pulso usa su animación propia.
#[cfg(mobile)]
mod visualizer {
    #[derive(Default)]
    pub struct Visualizer;

    #[tauri::command]
    pub fn visualizer_start() -> Result<(), String> {
        Err("El visualizador con el audio real solo está en la versión de escritorio.".into())
    }

    #[tauri::command]
    pub fn visualizer_stop() {}
}

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

const SPOTIFY_CREDENTIAL_SERVICE: &str = "com.dropmusic.desktop";
const SPOTIFY_CREDENTIAL_USER: &str = "spotify-oauth";
const SPOTIFY_API_BASE: &str = "https://api.spotify.com/v1";
const SPOTIFY_SEARCH_LIMIT: u32 = 10;

#[derive(Clone, Serialize)]
struct OAuthCallback {
    state: String,
    code: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct ConnectedAccount {
    name: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct SpotifySession {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    client_id: String,
    account: ConnectedAccount,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpotifyTrack {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: u32,
    artwork: String,
    url: String,
    album_id: String,
    album_type: String,
    artists: Vec<SpotifyArtistRef>,
}

#[derive(Clone, Serialize)]
struct SpotifyArtistRef {
    id: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpotifyAlbum {
    id: String,
    title: String,
    artist: String,
    artists: Vec<SpotifyArtistRef>,
    artwork: String,
    year: String,
    album_type: String,
    total_tracks: u32,
    url: String,
}

#[derive(Serialize)]
struct SpotifyArtist {
    id: String,
    name: String,
    image: String,
    genres: Vec<String>,
    followers: Option<u64>,
    url: String,
}

#[derive(Serialize)]
struct SpotifyCatalogResults {
    tracks: Vec<SpotifyTrack>,
    albums: Vec<SpotifyAlbum>,
    artists: Vec<SpotifyArtist>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpotifyArtistPage {
    artist: SpotifyArtist,
    top_tracks: Vec<SpotifyTrack>,
    albums: Vec<SpotifyAlbum>,
}

#[derive(Serialize)]
struct SpotifyAlbumPage {
    album: SpotifyAlbum,
    tracks: Vec<SpotifyTrack>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpotifySearchPage {
    tracks: Vec<SpotifyTrack>,
    total: u32,
    offset: u32,
    next_offset: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JamendoTrack {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: u32,
    artwork: String,
    audio_url: String,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JamendoSearchPage {
    tracks: Vec<JamendoTrack>,
}

fn parse_spotify_account(profile: &serde_json::Value) -> Result<ConnectedAccount, String> {
    let name = profile
        .get("display_name")
        .or_else(|| profile.get("name"))
        .or_else(|| profile.get("id"))
        .or_else(|| profile.get("sub"))
        .and_then(serde_json::Value::as_str)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "Spotify no devolvió un nombre de cuenta válido.".to_owned())?;
    Ok(ConnectedAccount {
        name: name.to_owned(),
    })
}

fn parse_access_token(body: &serde_json::Value) -> Result<(String, u64), String> {
    let access_token = body
        .get("access_token")
        .and_then(serde_json::Value::as_str)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "Spotify no devolvió un token de acceso válido.".to_owned())?;
    let token_type = body
        .get("token_type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Spotify no indicó el tipo del token de acceso.".to_owned())?;
    if !token_type.eq_ignore_ascii_case("bearer") {
        return Err("Spotify devolvió un tipo de token de acceso no compatible.".into());
    }
    let expires_in = body
        .get("expires_in")
        .and_then(serde_json::Value::as_u64)
        .filter(|duration| *duration > 0)
        .ok_or_else(|| {
            "Spotify no indicó una duración válida para el token de acceso.".to_owned()
        })?;
    Ok((access_token.to_owned(), expires_in))
}

fn spotify_search_params(query: &str, offset: u32) -> [(&'static str, String); 4] {
    [
        ("q", query.to_owned()),
        ("type", "track".to_owned()),
        ("limit", SPOTIFY_SEARCH_LIMIT.to_string()),
        ("offset", offset.to_string()),
    ]
}

fn spotify_credential() -> Result<Entry, String> {
    Entry::new(SPOTIFY_CREDENTIAL_SERVICE, SPOTIFY_CREDENTIAL_USER)
        .map_err(|error| format!("No se pudo acceder al almacén seguro de Windows: {error}"))
}

fn save_spotify_session(session: &SpotifySession) -> Result<(), String> {
    let credential = spotify_credential()?;
    let serialized = serde_json::to_string(session)
        .map_err(|error| format!("No se pudo preparar la sesión de Spotify: {error}"))?;
    credential.set_password(&serialized).map_err(|error| {
        format!("No se pudo guardar la sesión en el almacén seguro de Windows: {error}")
    })
}

fn load_spotify_session() -> Result<Option<SpotifySession>, String> {
    let credential = spotify_credential()?;
    let serialized = match credential.get_password() {
        Ok(serialized) => serialized,
        Err(KeyringError::NoEntry) => return Ok(None),
        Err(error) => {
            return Err(format!(
                "No se pudo leer la sesión desde el almacén seguro de Windows: {error}"
            ));
        }
    };
    let session = serde_json::from_str(&serialized)
        .map_err(|error| format!("La sesión guardada de Spotify no es válida: {error}"))?;
    Ok(Some(session))
}

fn delete_spotify_session() -> Result<(), String> {
    let credential = spotify_credential()?;
    match credential.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("No se pudo borrar la sesión de Spotify: {error}")),
    }
}

fn unix_timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| format!("No se pudo consultar la hora del sistema: {error}"))
}

fn parse_spotify_search_page(
    body: &serde_json::Value,
    offset: u32,
) -> Result<SpotifySearchPage, String> {
    let tracks_page = body
        .get("tracks")
        .ok_or_else(|| "Spotify no devolvió el catálogo de canciones.".to_owned())?;
    let total = tracks_page
        .get("total")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0) as u32;
    let items = tracks_page
        .get("items")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Spotify devolvió una lista de canciones inválida.".to_owned())?;
    let tracks = items
        .iter()
        .filter_map(|item| parse_spotify_track(item, None))
        .collect::<Vec<_>>();
    let page_end = offset + items.len() as u32;
    let next_offset = (page_end < total && page_end < 1000).then_some(page_end);
    Ok(SpotifySearchPage {
        tracks,
        total,
        offset,
        next_offset,
    })
}

fn parse_spotify_artist_refs(value: &serde_json::Value) -> Vec<SpotifyArtistRef> {
    value
        .get("artists")
        .and_then(serde_json::Value::as_array)
        .map(|artists| {
            artists
                .iter()
                .filter_map(|artist| {
                    // Las pistas locales de Spotify pueden traer artistas sin id.
                    Some(SpotifyArtistRef {
                        id: json_str(artist, "id"),
                        name: artist.get("name")?.as_str()?.to_owned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn first_image_url(value: &serde_json::Value) -> Option<&str> {
    value.get("images")?.as_array()?.first()?.get("url")?.as_str()
}

fn json_str(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// Las canciones de un álbum (GET /albums/{id}) no traen su álbum, así que se pasa aparte.
fn parse_spotify_track(
    item: &serde_json::Value,
    album_override: Option<&serde_json::Value>,
) -> Option<SpotifyTrack> {
    let id = item.get("id")?.as_str()?;
    let album = album_override.or_else(|| item.get("album"))?;
    let artists = parse_spotify_artist_refs(item);
    Some(SpotifyTrack {
        id: id.to_owned(),
        title: item.get("name")?.as_str()?.to_owned(),
        artist: artists
            .iter()
            .map(|artist| artist.name.as_str())
            .collect::<Vec<_>>()
            .join(", "),
        album: album.get("name")?.as_str()?.to_owned(),
        duration: item
            .get("duration_ms")?
            .as_u64()
            .map(|duration| (duration / 1000) as u32)?,
        artwork: first_image_url(album)?.to_owned(),
        url: format!("https://open.spotify.com/track/{id}"),
        album_id: json_str(album, "id"),
        album_type: json_str(album, "album_type"),
        artists,
    })
}

fn parse_spotify_album(item: &serde_json::Value) -> Option<SpotifyAlbum> {
    let id = item.get("id")?.as_str()?;
    let artists = parse_spotify_artist_refs(item);
    Some(SpotifyAlbum {
        id: id.to_owned(),
        title: item.get("name")?.as_str()?.to_owned(),
        artist: artists
            .iter()
            .map(|artist| artist.name.as_str())
            .collect::<Vec<_>>()
            .join(", "),
        artists,
        artwork: first_image_url(item).unwrap_or_default().to_owned(),
        year: json_str(item, "release_date").chars().take(4).collect(),
        album_type: json_str(item, "album_type"),
        total_tracks: item
            .get("total_tracks")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0) as u32,
        url: format!("https://open.spotify.com/album/{id}"),
    })
}

fn parse_spotify_artist(item: &serde_json::Value) -> Option<SpotifyArtist> {
    let id = item.get("id")?.as_str()?;
    Some(SpotifyArtist {
        id: id.to_owned(),
        name: item.get("name")?.as_str()?.to_owned(),
        image: first_image_url(item).unwrap_or_default().to_owned(),
        genres: item
            .get("genres")
            .and_then(serde_json::Value::as_array)
            .map(|genres| {
                genres
                    .iter()
                    .filter_map(|genre| genre.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default(),
        followers: item
            .pointer("/followers/total")
            .and_then(serde_json::Value::as_u64),
        url: format!("https://open.spotify.com/artist/{id}"),
    })
}

fn page_items(body: &serde_json::Value, key: &str) -> Vec<serde_json::Value> {
    body.get(key)
        .and_then(|page| page.get("items"))
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn validate_spotify_id(id: &str) -> Result<(), String> {
    if id.len() != 22 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err("Spotify devolvió un identificador no válido.".into());
    }
    Ok(())
}

/// GET autenticado a la API web de Spotify, renovando el token una vez si caducó.
async fn spotify_api_get(
    client_id: &str,
    path: &str,
    params: &[(&str, String)],
    action: &str,
) -> Result<serde_json::Value, String> {
    let mut session = usable_spotify_session(client_id)
        .await?
        .ok_or_else(|| format!("Vincula tu cuenta de Spotify para {action}."))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("No se pudo preparar Spotify: {error}"))?;
    let url = format!("{SPOTIFY_API_BASE}{path}");
    let mut response = client
        .get(&url)
        .bearer_auth(&session.access_token)
        .query(params)
        .send()
        .await
        .map_err(|error| format!("No se pudo {action}: {error}"))?;
    if response.status().as_u16() == 401 {
        refresh_spotify_session(&client, &mut session).await?;
        response = client
            .get(&url)
            .bearer_auth(&session.access_token)
            .query(params)
            .send()
            .await
            .map_err(|error| format!("No se pudo {action}: {error}"))?;
    }
    let status = response.status();
    let body: serde_json::Value = response.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        log::error!("Spotify respondió con HTTP {status} al intentar {action}.");
        if status.as_u16() == 401 {
            delete_spotify_session()?;
        }
        let detail = spotify_error_message(&body)
            .map(|message| format!(": {}", message.chars().take(240).collect::<String>()))
            .unwrap_or_default();
        return Err(match status.as_u16() {
            401 => "La sesión de Spotify dejó de ser válida. Vuelve a vincularla.".into(),
            429 => "Spotify limitó temporalmente las consultas. Espera un momento e inténtalo de nuevo.".into(),
            _ => format!("No se pudo {action} (HTTP {status}){detail}"),
        });
    }
    Ok(body)
}

#[tauri::command]
async fn spotify_search_catalog(
    client_id: String,
    query: String,
) -> Result<SpotifyCatalogResults, String> {
    let query = query.trim();
    if query.chars().count() < 2 || query.chars().count() > 200 {
        return Err("Escribe entre 2 y 200 caracteres para buscar en Spotify.".into());
    }
    let body = spotify_api_get(
        &client_id,
        "/search",
        &[
            ("q", query.to_owned()),
            ("type", "track,album,artist".to_owned()),
            ("limit", SPOTIFY_SEARCH_LIMIT.to_string()),
        ],
        "buscar en Spotify",
    )
    .await?;
    Ok(SpotifyCatalogResults {
        tracks: page_items(&body, "tracks")
            .iter()
            .filter_map(|item| parse_spotify_track(item, None))
            .collect(),
        albums: page_items(&body, "albums")
            .iter()
            .filter_map(parse_spotify_album)
            .collect(),
        artists: page_items(&body, "artists")
            .iter()
            .filter_map(parse_spotify_artist)
            .collect(),
    })
}

#[tauri::command]
async fn spotify_get_artist(
    client_id: String,
    artist_id: String,
) -> Result<SpotifyArtistPage, String> {
    validate_spotify_id(&artist_id)?;
    let body = spotify_api_get(
        &client_id,
        &format!("/artists/{artist_id}"),
        &[],
        "cargar el artista",
    )
    .await?;
    let artist =
        parse_spotify_artist(&body).ok_or_else(|| "Spotify devolvió un artista inválido.".to_owned())?;

    // Con la cuenta del usuario, Spotify usa el país de la cuenta y no este mercado.
    let top_tracks = match spotify_api_get(
        &client_id,
        &format!("/artists/{artist_id}/top-tracks"),
        &[("market", "US".to_owned())],
        "cargar las canciones populares",
    )
    .await
    {
        Ok(body) => body
            .get("tracks")
            .and_then(serde_json::Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| parse_spotify_track(item, None))
                    .collect()
            })
            .unwrap_or_default(),
        Err(error) => {
            // Las apps en modo desarrollo pueden no tener este endpoint: se buscan sus canciones.
            log::warn!("Canciones populares no disponibles, se usa la búsqueda: {error}");
            let body = spotify_api_get(
                &client_id,
                "/search",
                &[
                    ("q", format!("artist:\"{}\"", artist.name)),
                    ("type", "track".to_owned()),
                    ("limit", SPOTIFY_SEARCH_LIMIT.to_string()),
                ],
                "cargar las canciones populares",
            )
            .await?;
            page_items(&body, "tracks")
                .iter()
                .filter_map(|item| parse_spotify_track(item, None))
                .filter(|track| track.artists.iter().any(|item| item.id == artist.id))
                .collect()
        }
    };

    let mut albums = Vec::new();
    for offset in (0..30).step_by(SPOTIFY_SEARCH_LIMIT as usize) {
        let page = match spotify_api_get(
            &client_id,
            &format!("/artists/{artist_id}/albums"),
            &[
                ("include_groups", "album,single".to_owned()),
                ("limit", SPOTIFY_SEARCH_LIMIT.to_string()),
                ("offset", offset.to_string()),
            ],
            "cargar la discografía",
        )
        .await
        {
            Ok(page) => page,
            Err(error) if offset == 0 => return Err(error),
            Err(_) => break,
        };
        if let Some(items) = page.get("items").and_then(serde_json::Value::as_array) {
            albums.extend(items.iter().filter_map(parse_spotify_album));
        }
        if page.get("next").is_none_or(serde_json::Value::is_null) {
            break;
        }
    }

    Ok(SpotifyArtistPage {
        artist,
        top_tracks,
        albums,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpotifyRadioBatch {
    genres: Vec<String>,
    same_artist: Vec<SpotifyTrack>,
    related: Vec<SpotifyTrack>,
    genre: Vec<SpotifyTrack>,
    related_artists: Vec<SpotifyArtistRef>,
}

async fn search_track_items(
    client_id: &str,
    query: String,
    offset: u32,
) -> Result<Vec<SpotifyTrack>, String> {
    let body = spotify_api_get(
        client_id,
        "/search",
        &[
            ("q", query),
            ("type", "track".to_owned()),
            ("limit", SPOTIFY_SEARCH_LIMIT.to_string()),
            ("offset", offset.to_string()),
        ],
        "preparar la radio",
    )
    .await?;
    Ok(page_items(&body, "tracks")
        .iter()
        .filter_map(|item| parse_spotify_track(item, None))
        .collect())
}

/// Tanda de canciones para la radio, al estilo de Spotify: no busca el texto escrito,
/// sino canciones del artista, de artistas relacionados (colaboradores o del mismo género)
/// y del mismo género. La API de recomendaciones ya no está disponible para apps nuevas.
#[tauri::command]
async fn spotify_build_radio(
    client_id: String,
    artist_id: Option<String>,
    artist_name: Option<String>,
    genre: Option<String>,
    offset: u32,
) -> Result<SpotifyRadioBatch, String> {
    let offset = offset.min(900);
    let artist_id = artist_id.filter(|id| validate_spotify_id(id).is_ok());
    let artist_name = artist_name
        .map(|name| name.trim().replace('"', ""))
        .filter(|name| !name.is_empty() && name.len() <= 200);
    let mut genres: Vec<String> = genre
        .map(|genre| genre.trim().replace('"', ""))
        .filter(|genre| !genre.is_empty() && genre.len() <= 100)
        .into_iter()
        .collect();

    if let Some(id) = &artist_id {
        if let Ok(body) = spotify_api_get(&client_id, &format!("/artists/{id}"), &[], "preparar la radio").await {
            if let Some(artist) = parse_spotify_artist(&body) {
                genres.extend(artist.genres);
            }
        }
    }
    genres.dedup();

    // Canciones del propio artista; sus colaboraciones dicen quién está "cerca" de él.
    let mut same_artist = Vec::new();
    let mut collaborators: Vec<(SpotifyArtistRef, u32)> = Vec::new();
    if let Some(name) = &artist_name {
        let tracks = search_track_items(&client_id, format!("artist:\"{name}\""), offset).await?;
        for track in tracks {
            let is_seed = |artist: &SpotifyArtistRef| {
                artist_id.as_deref().map_or(artist.name.eq_ignore_ascii_case(name), |id| artist.id == id)
            };
            if !track.artists.iter().any(is_seed) {
                continue;
            }
            for artist in track.artists.iter().filter(|artist| !is_seed(artist) && !artist.id.is_empty()) {
                match collaborators.iter_mut().find(|(known, _)| known.id == artist.id) {
                    Some((_, count)) => *count += 1,
                    None => collaborators.push((artist.clone(), 1)),
                }
            }
            same_artist.push(track);
        }
    }
    collaborators.sort_by(|a, b| b.1.cmp(&a.1));
    let mut related_artists: Vec<SpotifyArtistRef> =
        collaborators.into_iter().map(|(artist, _)| artist).collect();

    // Si hay pocos colaboradores, se completan con artistas del mismo género.
    if related_artists.len() < 4 {
        if let Some(main_genre) = genres.first() {
            if let Ok(body) = spotify_api_get(
                &client_id,
                "/search",
                &[
                    ("q", format!("genre:\"{main_genre}\"")),
                    ("type", "artist".to_owned()),
                    ("limit", SPOTIFY_SEARCH_LIMIT.to_string()),
                    ("offset", (offset / 2).to_string()),
                ],
                "preparar la radio",
            )
            .await
            {
                for artist in page_items(&body, "artists").iter().filter_map(parse_spotify_artist) {
                    let is_seed = artist_id.as_deref() == Some(artist.id.as_str());
                    if !is_seed && !related_artists.iter().any(|known| known.id == artist.id) {
                        related_artists.push(SpotifyArtistRef { id: artist.id, name: artist.name });
                    }
                }
            }
        }
    }

    let mut related = Vec::new();
    for artist in related_artists.iter().take(3) {
        let query = format!("artist:\"{}\"", artist.name.replace('"', ""));
        if let Ok(tracks) = search_track_items(&client_id, query, 0).await {
            related.extend(
                tracks
                    .into_iter()
                    .filter(|track| track.artists.iter().any(|item| item.id == artist.id))
                    .take(4),
            );
        }
    }

    let mut genre_tracks = Vec::new();
    if let Some(main_genre) = genres.first() {
        let query = format!("genre:\"{main_genre}\"");
        if let Ok(tracks) = search_track_items(&client_id, query.clone(), offset).await {
            genre_tracks.extend(tracks);
        }
        // Una radio solo de género necesita más volumen.
        if artist_name.is_none() {
            if let Ok(tracks) = search_track_items(&client_id, query, offset + SPOTIFY_SEARCH_LIMIT).await {
                genre_tracks.extend(tracks);
            }
        }
    }

    Ok(SpotifyRadioBatch {
        genres,
        same_artist,
        related,
        genre: genre_tracks,
        related_artists,
    })
}

#[derive(Serialize)]
struct Lyrics {
    synced: Option<String>,
    plain: Option<String>,
    instrumental: bool,
}

const LRCLIB_API_BASE: &str = "https://lrclib.net/api";

fn parse_lyrics(item: &serde_json::Value) -> Lyrics {
    let text = |key: &str| {
        item.get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    Lyrics {
        synced: text("syncedLyrics"),
        plain: text("plainLyrics"),
        instrumental: item
            .get("instrumental")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    }
}

/// Busca la letra en LRCLIB (base de datos abierta de letras sincronizadas, sin clave).
#[tauri::command]
async fn lyrics_get(
    artist: String,
    title: String,
    album: String,
    duration: u32,
) -> Result<Option<Lyrics>, String> {
    let artist = artist.trim();
    let title = title.trim();
    if artist.is_empty() || title.is_empty() || artist.len() > 300 || title.len() > 300 {
        return Ok(None);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("DropMusic/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("No se pudo preparar la búsqueda de letras: {error}"))?;

    let exact = client
        .get(format!("{LRCLIB_API_BASE}/get"))
        .query(&[
            ("artist_name", artist.to_owned()),
            ("track_name", title.to_owned()),
            ("album_name", album.trim().to_owned()),
            ("duration", duration.to_string()),
        ])
        .send()
        .await
        .map_err(|error| format!("No se pudo buscar la letra: {error}"))?;
    if exact.status().is_success() {
        let body: serde_json::Value = exact
            .json()
            .await
            .map_err(|error| format!("La letra llegó en un formato inválido: {error}"))?;
        return Ok(Some(parse_lyrics(&body)));
    }

    // Sin coincidencia exacta: se busca por título y artista y se elige la de duración más parecida.
    // Si no aparece, se prueba sin "(feat. …)" ni " - Remastered …", que suelen cambiar entre servicios.
    let simple_title = title
        .split(" - ")
        .next()
        .unwrap_or(title)
        .split(" (")
        .next()
        .unwrap_or(title)
        .trim()
        .to_owned();
    let mut titles = vec![title.to_owned()];
    if !simple_title.is_empty() && simple_title != title {
        titles.push(simple_title);
    }
    for search_title in titles {
        if let Some(lyrics) = search_lyrics(&client, &search_title, artist, duration).await? {
            return Ok(Some(lyrics));
        }
    }
    Ok(None)
}

async fn search_lyrics(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    duration: u32,
) -> Result<Option<Lyrics>, String> {
    let search = client
        .get(format!("{LRCLIB_API_BASE}/search"))
        .query(&[("track_name", title), ("artist_name", artist)])
        .send()
        .await
        .map_err(|error| format!("No se pudo buscar la letra: {error}"))?;
    if !search.status().is_success() {
        return Ok(None);
    }
    let results: serde_json::Value = search
        .json()
        .await
        .map_err(|error| format!("La letra llegó en un formato inválido: {error}"))?;
    let best = results.as_array().and_then(|items| {
        items
            .iter()
            .filter(|item| {
                item.get("syncedLyrics").is_some_and(|value| value.is_string())
                    || item.get("plainLyrics").is_some_and(|value| value.is_string())
            })
            .min_by_key(|item| {
                let item_duration = item
                    .get("duration")
                    .and_then(serde_json::Value::as_f64)
                    .unwrap_or(0.0) as i64;
                let missing_sync = i64::from(!item.get("syncedLyrics").is_some_and(|value| value.is_string()));
                missing_sync * 10_000 + (item_duration - i64::from(duration)).abs()
            })
    });
    Ok(best.map(parse_lyrics))
}

#[tauri::command]
async fn spotify_get_top_artists(client_id: String) -> Result<Vec<SpotifyArtist>, String> {
    let body = spotify_api_get(
        &client_id,
        "/me/top/artists",
        &[
            ("limit", SPOTIFY_SEARCH_LIMIT.to_string()),
            ("time_range", "medium_term".to_owned()),
        ],
        "cargar tus artistas favoritos",
    )
    .await?;
    Ok(body
        .get("items")
        .and_then(serde_json::Value::as_array)
        .map(|items| items.iter().filter_map(parse_spotify_artist).collect())
        .unwrap_or_default())
}

#[tauri::command]
async fn spotify_get_new_releases(client_id: String) -> Result<Vec<SpotifyAlbum>, String> {
    let body = spotify_api_get(
        &client_id,
        "/browse/new-releases",
        &[("limit", SPOTIFY_SEARCH_LIMIT.to_string())],
        "cargar los lanzamientos nuevos",
    )
    .await?;
    Ok(page_items(&body, "albums")
        .iter()
        .filter_map(parse_spotify_album)
        .collect())
}

#[tauri::command]
async fn spotify_get_album(client_id: String, album_id: String) -> Result<SpotifyAlbumPage, String> {
    validate_spotify_id(&album_id)?;
    let body = spotify_api_get(
        &client_id,
        &format!("/albums/{album_id}"),
        &[],
        "cargar el álbum",
    )
    .await?;
    let album =
        parse_spotify_album(&body).ok_or_else(|| "Spotify devolvió un álbum inválido.".to_owned())?;
    let tracks = page_items(&body, "tracks")
        .iter()
        .filter_map(|item| parse_spotify_track(item, Some(&body)))
        .collect();
    Ok(SpotifyAlbumPage { album, tracks })
}

fn spotify_error_message(body: &serde_json::Value) -> Option<&str> {
    body.pointer("/error/message")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            body.get("error_description")
                .and_then(serde_json::Value::as_str)
        })
        .or_else(|| body.get("error").and_then(serde_json::Value::as_str))
}

fn parse_jamendo_search_page(body: &serde_json::Value) -> Result<JamendoSearchPage, String> {
    let headers = body.get("headers");
    if headers
        .and_then(|value| value.get("status"))
        .and_then(serde_json::Value::as_str)
        .is_some_and(|status| status != "success")
    {
        let message = headers
            .and_then(|value| value.get("error_message"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Jamendo rechazó la búsqueda.");
        return Err(format!("La API de Jamendo devolvió un error: {message}"));
    }

    let results = body
        .get("results")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Jamendo devolvió una lista de canciones inválida.".to_owned())?;
    let tracks = results
        .iter()
        .filter_map(|item| {
            let id = item
                .get("id")?
                .as_str()
                .map(str::to_owned)
                .or_else(|| item.get("id")?.as_u64().map(|id| id.to_string()))?;
            let artwork = item
                .get("image")
                .and_then(serde_json::Value::as_str)
                .or_else(|| item.get("album_image").and_then(serde_json::Value::as_str))?;
            let audio_url = item.get("audio")?.as_str()?;
            let url = item
                .get("shareurl")
                .and_then(serde_json::Value::as_str)
                .filter(|url| !url.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("https://www.jamendo.com/track/{id}"));
            Some(JamendoTrack {
                id,
                title: item.get("name")?.as_str()?.to_owned(),
                artist: item.get("artist_name")?.as_str()?.to_owned(),
                album: item
                    .get("album_name")
                    .and_then(serde_json::Value::as_str)
                    .filter(|album| !album.is_empty())
                    .unwrap_or("Sencillo")
                    .to_owned(),
                duration: u32::try_from(item.get("duration")?.as_u64()?).ok()?,
                artwork: artwork.to_owned(),
                audio_url: audio_url.to_owned(),
                url,
            })
        })
        .collect();
    Ok(JamendoSearchPage { tracks })
}

async fn refresh_spotify_session(
    client: &reqwest::Client,
    session: &mut SpotifySession,
) -> Result<(), String> {
    let response = client
        .post("https://accounts.spotify.com/api/token")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", session.refresh_token.as_str()),
            ("client_id", session.client_id.as_str()),
        ])
        .send()
        .await
        .map_err(|error| format!("No se pudo renovar la sesión de Spotify: {error}"))?;
    let status = response.status();
    let body: serde_json::Value = response.json().await.map_err(|error| {
        format!("Spotify devolvió una respuesta de renovación inválida: {error}")
    })?;
    if !status.is_success() {
        let error_code = body
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown_error");
        if error_code == "invalid_grant" {
            delete_spotify_session()?;
            return Err("La sesión de Spotify expiró. Vuelve a vincular tu cuenta.".into());
        }
        return Err(format!(
            "Spotify rechazó la renovación de sesión (HTTP {status}, {error_code}). Comprueba la configuración de la aplicación e inténtalo de nuevo."
        ));
    }
    let (access_token, expires_in) = parse_access_token(&body)?;
    session.access_token = access_token;
    if let Some(refresh_token) = body
        .get("refresh_token")
        .and_then(serde_json::Value::as_str)
    {
        session.refresh_token = refresh_token.to_owned();
    }
    session.expires_at = unix_timestamp()?.saturating_add(expires_in);
    save_spotify_session(session)
}

async fn usable_spotify_session(client_id: &str) -> Result<Option<SpotifySession>, String> {
    let Some(mut session) = load_spotify_session()? else {
        return Ok(None);
    };
    if session.client_id != client_id {
        return Err(
            "La cuenta está vinculada con otro Client ID. Desvincúlala y vuelve a conectarla."
                .into(),
        );
    }
    if session.expires_at <= unix_timestamp()?.saturating_add(60) {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|error| format!("No se pudo preparar la renovación de Spotify: {error}"))?;
        refresh_spotify_session(&client, &mut session).await?;
    }
    Ok(Some(session))
}

fn decode_query_value(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok()?;
                decoded.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(decoded).ok()
}

fn query_value(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|part| {
        let (name, value) = part.split_once('=')?;
        (decode_query_value(name).as_deref() == Some(key))
            .then(|| decode_query_value(value))
            .flatten()
    })
}

fn respond_to_callback(stream: &mut TcpStream, success: bool) -> std::io::Result<()> {
    let (status, message) = if success {
        (
            "200 OK",
            "Autorización completada. Puedes volver a DropMusic.",
        )
    } else {
        (
            "400 Bad Request",
            "No se pudo completar la autorización. Vuelve a DropMusic.",
        )
    };
    let body = format!(
        "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>DropMusic</title><body style=\"font:16px sans-serif;background:#17151a;color:#eee;padding:3rem\">{message}</body></html>"
    );
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    stream.flush()
}

#[tauri::command]
fn start_oauth_callback(app: AppHandle, state: String, provider: String) -> Result<String, String> {
    if state.len() < 32
        || !state
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("El estado OAuth no tiene un formato válido.".into());
    }
    let callback_path = match provider.as_str() {
        "spotify" => "/callback",
        "google" => "/",
        _ => return Err("Este proveedor no admite esta conexión.".into()),
    };

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("No se pudo iniciar el retorno OAuth local: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let expected_state = state.clone();

    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(180);
        while Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    if let Err(error) = stream.set_read_timeout(Some(Duration::from_secs(5))) {
                        log::error!("No se pudo limitar la espera del retorno OAuth: {error}");
                        continue;
                    }
                    let mut request = [0; 8192];
                    let Ok(size) = stream.read(&mut request) else {
                        continue;
                    };
                    let request = String::from_utf8_lossy(&request[..size]);
                    let Some(target) = request
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                    else {
                        let _ = respond_to_callback(&mut stream, false);
                        continue;
                    };
                    let Some((path, query)) = target.split_once('?') else {
                        let _ = respond_to_callback(&mut stream, false);
                        continue;
                    };
                    if path != callback_path {
                        let _ = respond_to_callback(&mut stream, false);
                        continue;
                    }
                    if query_value(query, "state").as_deref() != Some(expected_state.as_str()) {
                        let _ = respond_to_callback(&mut stream, false);
                        continue;
                    }

                    let callback = OAuthCallback {
                        state: expected_state.clone(),
                        code: query_value(query, "code"),
                        error: query_value(query, "error"),
                    };
                    let success = callback.code.is_some() && callback.error.is_none();
                    let _ = respond_to_callback(&mut stream, success);
                    if let Err(error) = app.emit("dropmusic-oauth-callback", callback) {
                        log::error!("No se pudo entregar el resultado OAuth a DropMusic: {error}");
                    }
                    return;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(error) => {
                    log::error!("Falló el retorno OAuth local: {error}");
                    break;
                }
            }
        }

        let _ = app.emit(
            "dropmusic-oauth-callback",
            OAuthCallback {
                state: expected_state,
                code: None,
                error: Some("timeout".into()),
            },
        );
    });

    let callback_path = if provider == "spotify" {
        "/callback"
    } else {
        ""
    };
    Ok(format!("http://127.0.0.1:{port}{callback_path}"))
}

#[tauri::command]
async fn exchange_oauth_code(
    provider: String,
    code: String,
    redirect_uri: String,
    code_verifier: String,
    client_id: String,
) -> Result<ConnectedAccount, String> {
    let (token_url, profile_url, provider_name) = match provider.as_str() {
        "spotify" => (
            "https://accounts.spotify.com/api/token",
            "https://api.spotify.com/v1/me",
            "Spotify",
        ),
        "google" => (
            "https://oauth2.googleapis.com/token",
            "https://www.googleapis.com/oauth2/v3/userinfo",
            "Google",
        ),
        _ => return Err("Este proveedor no admite esta conexión.".into()),
    };
    if code.is_empty()
        || client_id.is_empty()
        || code_verifier.len() < 43
        || !redirect_uri.starts_with("http://127.0.0.1:")
    {
        return Err("Faltan datos válidos para completar OAuth.".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("No se pudo preparar la conexión con {provider_name}: {error}"))?;
    let token_response = client
        .post(token_url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
            ("client_id", &client_id),
            ("code_verifier", &code_verifier),
        ])
        .send()
        .await
        .map_err(|error| {
            format!("No se pudo contactar con {provider_name} para completar OAuth: {error}")
        })?;
    let token_status = token_response.status();
    let token_body: serde_json::Value = token_response
        .json()
        .await
        .map_err(|error| format!("La respuesta OAuth de {provider_name} no era válida: {error}"))?;
    if !token_status.is_success() {
        log::error!("El intercambio OAuth de {provider_name} respondió con HTTP {token_status}.");
        return Err(format!(
            "La autorización de {provider_name} fue rechazada (HTTP {token_status}). Revisa el Client ID y la URI de retorno registrada."
        ));
    }
    let (access_token, spotify_expires_in) = if provider == "spotify" {
        parse_access_token(&token_body)?
    } else {
        (
            token_body
                .get("access_token")
                .and_then(serde_json::Value::as_str)
                .filter(|token| !token.is_empty())
                .ok_or_else(|| format!("{provider_name} no devolvió un token de acceso válido."))?
                .to_owned(),
            0,
        )
    };
    let refresh_token = token_body
        .get("refresh_token")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let profile_response = client
        .get(profile_url)
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|error| format!("No se pudo consultar el perfil de {provider_name}: {error}"))?;
    let profile_status = profile_response.status();
    let profile: serde_json::Value = profile_response.json().await.map_err(|error| {
        format!("El perfil de {provider_name} no devolvió una respuesta válida: {error}")
    })?;
    if !profile_status.is_success() {
        log::error!(
            "La consulta del perfil de {provider_name} respondió con HTTP {profile_status}."
        );
        return Err(format!(
            "No se pudo confirmar la cuenta de {provider_name} (HTTP {profile_status})."
        ));
    }

    let account =
        parse_spotify_account(&profile).map_err(|error| error.replace("Spotify", provider_name))?;
    if provider == "spotify" {
        let refresh_token = refresh_token.ok_or_else(|| {
            "Spotify no devolvió un refresh token. Desconecta la app desde tu cuenta de Spotify y vuelve a autorizarla.".to_owned()
        })?;
        save_spotify_session(&SpotifySession {
            access_token,
            refresh_token,
            expires_at: unix_timestamp()?.saturating_add(spotify_expires_in),
            client_id,
            account: account.clone(),
        })?;
    }
    Ok(account)
}

#[tauri::command]
async fn spotify_get_account(client_id: String) -> Result<Option<ConnectedAccount>, String> {
    let Some(mut session) = usable_spotify_session(&client_id).await? else {
        return Ok(None);
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("No se pudo preparar la validación de Spotify: {error}"))?;
    let response = client
        .get(format!("{SPOTIFY_API_BASE}/me"))
        .bearer_auth(&session.access_token)
        .send()
        .await
        .map_err(|error| format!("No se pudo validar la sesión de Spotify: {error}"))?;
    let response = if response.status().as_u16() == 401 {
        refresh_spotify_session(&client, &mut session).await?;
        client
            .get(format!("{SPOTIFY_API_BASE}/me"))
            .bearer_auth(&session.access_token)
            .send()
            .await
            .map_err(|error| format!("No se pudo validar la sesión renovada de Spotify: {error}"))?
    } else {
        response
    };
    let status = response.status();
    let profile: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Spotify devolvió un perfil inválido: {error}"))?;
    if !status.is_success() {
        if status.as_u16() == 401 {
            delete_spotify_session()?;
            return Err("Spotify rechazó el token renovado. Vuelve a vincular la cuenta.".into());
        }
        return Err(format!(
            "No se pudo validar la sesión de Spotify (HTTP {status})."
        ));
    }
    let account = parse_spotify_account(&profile)?;
    session.account = account.clone();
    save_spotify_session(&session)?;
    Ok(Some(account))
}

#[tauri::command]
async fn spotify_get_playback_token(client_id: String) -> Result<String, String> {
    let session = usable_spotify_session(&client_id)
        .await?
        .ok_or_else(|| "Vincula tu cuenta de Spotify para activar el reproductor.".to_owned())?;
    Ok(session.access_token)
}

#[tauri::command]
async fn spotify_get_top_tracks(client_id: String) -> Result<SpotifySearchPage, String> {
    let Some(mut session) = load_spotify_session()? else {
        return Err("Vincula tu cuenta de Spotify para cargar tus sugerencias.".into());
    };
    if session.client_id != client_id {
        return Err(
            "La cuenta está vinculada con otro Client ID. Desvincúlala y vuelve a conectarla."
                .into(),
        );
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("No se pudo preparar Spotify: {error}"))?;
    if session.expires_at <= unix_timestamp()?.saturating_add(60) {
        refresh_spotify_session(&client, &mut session).await?;
    }
    let response = client
        .get(format!("{SPOTIFY_API_BASE}/me/top/tracks"))
        .bearer_auth(&session.access_token)
        .query(&[("limit", "10"), ("time_range", "medium_term")])
        .send()
        .await
        .map_err(|error| format!("No se pudieron cargar tus sugerencias de Spotify: {error}"))?;
    let response = if response.status().as_u16() == 401 {
        refresh_spotify_session(&client, &mut session).await?;
        client
            .get(format!("{SPOTIFY_API_BASE}/me/top/tracks"))
            .bearer_auth(&session.access_token)
            .query(&[("limit", "10"), ("time_range", "medium_term")])
            .send()
            .await
            .map_err(|error| format!("No se pudieron cargar tus sugerencias de Spotify: {error}"))?
    } else {
        response
    };
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Spotify devolvió sugerencias inválidas: {error}"))?;
    if !status.is_success() {
        let detail = spotify_error_message(&body)
            .map(|message| format!(": {message}"))
            .unwrap_or_default();
        if status.as_u16() == 401 {
            delete_spotify_session()?;
        }
        return Err(match status.as_u16() {
            401 => "La sesión de Spotify expiró. Vuelve a vincular la cuenta.".into(),
            403 => format!(
                "Spotify no autorizó tus sugerencias. Reautoriza DropMusic para conceder el permiso de historial.{detail}"
            ),
            429 => {
                "Spotify limitó temporalmente las sugerencias. Inténtalo de nuevo más tarde.".into()
            }
            _ => {
                format!("No se pudieron cargar tus sugerencias de Spotify (HTTP {status}){detail}")
            }
        });
    }

    save_spotify_session(&session)?;
    let wrapped = serde_json::json!({ "tracks": body });
    parse_spotify_search_page(&wrapped, 0)
}

#[tauri::command]
async fn spotify_start_playback(
    client_id: String,
    device_id: String,
    track_id: String,
) -> Result<(), String> {
    if device_id.is_empty() || device_id.len() > 200 || device_id.chars().any(char::is_control) {
        return Err("El reproductor de Spotify todavía no está listo. Inténtalo de nuevo.".into());
    }
    if track_id.len() != 22 || !track_id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err("Spotify devolvió un identificador de canción no válido.".into());
    }

    let Some(mut session) = load_spotify_session()? else {
        return Err("Vincula tu cuenta de Spotify para reproducir canciones.".into());
    };
    if session.client_id != client_id {
        return Err(
            "La cuenta está vinculada con otro Client ID. Desvincúlala y vuelve a conectarla."
                .into(),
        );
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("No se pudo preparar la reproducción de Spotify: {error}"))?;
    if session.expires_at <= unix_timestamp()?.saturating_add(60) {
        refresh_spotify_session(&client, &mut session).await?;
    }

    let playback_url = format!("{SPOTIFY_API_BASE}/me/player/play");
    let playback_params = [("device_id", device_id.as_str())];
    let playback_body = serde_json::json!({
        "uris": [format!("spotify:track:{track_id}")]
    });
    let response = client
        .put(&playback_url)
        .bearer_auth(&session.access_token)
        .query(&playback_params)
        .json(&playback_body)
        .send()
        .await
        .map_err(|error| format!("No se pudo iniciar la reproducción en Spotify: {error}"))?;
    let response = if response.status().as_u16() == 401 {
        refresh_spotify_session(&client, &mut session).await?;
        client
            .put(&playback_url)
            .bearer_auth(&session.access_token)
            .query(&playback_params)
            .json(&playback_body)
            .send()
            .await
            .map_err(|error| format!("No se pudo iniciar la reproducción en Spotify: {error}"))?
    } else {
        response
    };
    let status = response.status();
    if !status.is_success() {
        let body = response
            .json::<serde_json::Value>()
            .await
            .unwrap_or(serde_json::Value::Null);
        let detail = spotify_error_message(&body)
            .map(|message| format!(": {message}"))
            .unwrap_or_default();
        if status.as_u16() == 401 {
            delete_spotify_session()?;
        }
        return Err(match status.as_u16() {
            401 => "La sesión de Spotify expiró. Vuelve a vincular la cuenta.".into(),
            403 => format!(
                "Spotify requiere una cuenta Premium y los permisos de reproducción. Vuelve a autorizar DropMusic en Ajustes.{detail}"
            ),
            404 => "Spotify no encontró el reproductor activo. Espera a que termine de conectar y vuelve a intentarlo.".into(),
            429 => "Spotify limitó temporalmente la reproducción. Inténtalo de nuevo más tarde.".into(),
            _ => format!("Spotify no pudo iniciar la reproducción (HTTP {status}){detail}"),
        });
    }
    save_spotify_session(&session)
}

#[tauri::command]
async fn spotify_set_playback_option(
    client_id: String,
    device_id: String,
    option: String,
    enabled: bool,
) -> Result<(), String> {
    if device_id.is_empty() || device_id.len() > 200 || device_id.chars().any(char::is_control) {
        return Err("El reproductor de Spotify todavía no está listo. Inténtalo de nuevo.".into());
    }
    let (endpoint, state) = match option.as_str() {
        "shuffle" => ("/me/player/shuffle", enabled.to_string()),
        "repeat" => (
            "/me/player/repeat",
            if enabled { "track" } else { "off" }.to_owned(),
        ),
        _ => return Err("Este ajuste de reproducción de Spotify no es válido.".into()),
    };
    let Some(mut session) = load_spotify_session()? else {
        return Err("Vincula tu cuenta de Spotify para controlar la reproducción.".into());
    };
    if session.client_id != client_id {
        return Err(
            "La cuenta está vinculada con otro Client ID. Desvincúlala y vuelve a conectarla."
                .into(),
        );
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("No se pudo preparar el reproductor de Spotify: {error}"))?;
    if session.expires_at <= unix_timestamp()?.saturating_add(60) {
        refresh_spotify_session(&client, &mut session).await?;
    }

    let url = format!("{SPOTIFY_API_BASE}{endpoint}");
    let params = [("device_id", device_id.as_str()), ("state", state.as_str())];
    let response = client
        .put(&url)
        .bearer_auth(&session.access_token)
        .query(&params)
        .send()
        .await
        .map_err(|error| format!("No se pudo cambiar el ajuste de Spotify: {error}"))?;
    let response = if response.status().as_u16() == 401 {
        refresh_spotify_session(&client, &mut session).await?;
        client
            .put(&url)
            .bearer_auth(&session.access_token)
            .query(&params)
            .send()
            .await
            .map_err(|error| format!("No se pudo cambiar el ajuste de Spotify: {error}"))?
    } else {
        response
    };
    let status = response.status();
    if !status.is_success() {
        let body = response
            .json::<serde_json::Value>()
            .await
            .unwrap_or(serde_json::Value::Null);
        let detail = spotify_error_message(&body)
            .map(|message| format!(": {message}"))
            .unwrap_or_default();
        if status.as_u16() == 401 {
            delete_spotify_session()?;
        }
        return Err(match status.as_u16() {
            401 => "La sesión de Spotify expiró. Vuelve a vincular la cuenta.".into(),
            403 => format!(
                "Spotify requiere permisos de control de reproducción. Actualiza los permisos en Ajustes.{detail}"
            ),
            404 => "No se encontró el reproductor activo de Spotify.".into(),
            _ => format!("Spotify no pudo cambiar el ajuste (HTTP {status}){detail}"),
        });
    }
    save_spotify_session(&session)
}

fn spotify_skip_endpoint(direction: &str) -> Result<&'static str, String> {
    match direction {
        "next" => Ok("/me/player/next"),
        "previous" => Ok("/me/player/previous"),
        _ => Err("La dirección para cambiar de canción no es válida.".into()),
    }
}

#[tauri::command]
async fn spotify_skip_track(
    client_id: String,
    device_id: String,
    direction: String,
) -> Result<(), String> {
    if device_id.is_empty() || device_id.len() > 200 || device_id.chars().any(char::is_control) {
        return Err("El reproductor de Spotify todavía no está listo. Inténtalo de nuevo.".into());
    }
    let endpoint = spotify_skip_endpoint(&direction)?;
    let Some(mut session) = load_spotify_session()? else {
        return Err("Vincula tu cuenta de Spotify para cambiar de canción.".into());
    };
    if session.client_id != client_id {
        return Err(
            "La cuenta está vinculada con otro Client ID. Desvincúlala y vuelve a conectarla."
                .into(),
        );
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("No se pudo preparar el reproductor de Spotify: {error}"))?;
    if session.expires_at <= unix_timestamp()?.saturating_add(60) {
        refresh_spotify_session(&client, &mut session).await?;
    }

    let url = format!("{SPOTIFY_API_BASE}{endpoint}");
    let params = [("device_id", device_id.as_str())];
    let response = client
        .post(&url)
        .bearer_auth(&session.access_token)
        .query(&params)
        .send()
        .await
        .map_err(|error| format!("No se pudo cambiar de canción en Spotify: {error}"))?;
    let response = if response.status().as_u16() == 401 {
        refresh_spotify_session(&client, &mut session).await?;
        client
            .post(&url)
            .bearer_auth(&session.access_token)
            .query(&params)
            .send()
            .await
            .map_err(|error| format!("No se pudo cambiar de canción en Spotify: {error}"))?
    } else {
        response
    };
    let status = response.status();
    if !status.is_success() {
        let body = response
            .json::<serde_json::Value>()
            .await
            .unwrap_or(serde_json::Value::Null);
        let detail = spotify_error_message(&body)
            .map(|message| format!(": {message}"))
            .unwrap_or_default();
        if status.as_u16() == 401 {
            delete_spotify_session()?;
        }
        return Err(match status.as_u16() {
            401 => "La sesión de Spotify expiró. Vuelve a vincular la cuenta.".into(),
            403 => format!(
                "Spotify requiere permisos de control de reproducción. Actualiza los permisos en Ajustes.{detail}"
            ),
            404 => "Spotify no encontró una siguiente canción o un reproductor activo.".into(),
            429 => "Spotify limitó temporalmente el cambio de canción. Inténtalo más tarde.".into(),
            _ => format!("Spotify no pudo cambiar de canción (HTTP {status}){detail}"),
        });
    }
    save_spotify_session(&session)
}

#[tauri::command]
async fn spotify_search_tracks(
    client_id: String,
    query: String,
    offset: u32,
) -> Result<SpotifySearchPage, String> {
    let query = query.trim();
    if query.chars().count() < 2 || query.chars().count() > 200 {
        return Err("Escribe entre 2 y 200 caracteres para buscar en Spotify.".into());
    }
    if offset > 950 {
        return Err("Se alcanzó el límite de resultados de búsqueda de Spotify.".into());
    }
    let session = usable_spotify_session(&client_id)
        .await?
        .ok_or_else(|| "Vincula tu cuenta de Spotify para buscar en su catálogo.".to_owned())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("No se pudo preparar la búsqueda de Spotify: {error}"))?;
    let search_params = spotify_search_params(query, offset);
    let response = client
        .get(format!("{SPOTIFY_API_BASE}/search"))
        .bearer_auth(&session.access_token)
        .query(&search_params)
        .send()
        .await
        .map_err(|error| format!("No se pudo buscar en el catálogo de Spotify: {error}"))?;

    let response = if response.status().as_u16() == 401 {
        let mut refreshed = session;
        refresh_spotify_session(&client, &mut refreshed).await?;
        client
            .get(format!("{SPOTIFY_API_BASE}/search"))
            .bearer_auth(&refreshed.access_token)
            .query(&search_params)
            .send()
            .await
            .map_err(|error| format!("No se pudo buscar en el catálogo de Spotify: {error}"))?
    } else {
        response
    };
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Spotify devolvió resultados de búsqueda inválidos: {error}"))?;
    if !status.is_success() {
        log::error!("La búsqueda del catálogo de Spotify respondió con HTTP {status}.");
        if status.as_u16() == 401 {
            delete_spotify_session()?;
        }
        let message = spotify_error_message(&body)
            .map(|message| format!(": {}", message.chars().take(240).collect::<String>()))
            .unwrap_or_default();
        return Err(match status.as_u16() {
            401 => "La sesión de Spotify dejó de ser válida. Vuelve a vincularla.".into(),
            403 => "Spotify rechazó la búsqueda. Comprueba el acceso de tu aplicación en Spotify Developer Dashboard.".into(),
            429 => "Spotify limitó temporalmente las búsquedas. Espera un momento e inténtalo de nuevo.".into(),
            _ => format!("Spotify no pudo completar la búsqueda (HTTP {status}){message}"),
        });
    }

    parse_spotify_search_page(&body, offset)
}

#[tauri::command]
async fn jamendo_search_tracks(
    client_id: String,
    query: String,
) -> Result<JamendoSearchPage, String> {
    let query = query.trim();
    if client_id.trim().is_empty() {
        return Err(
            "Configura el Client ID de Jamendo en Ajustes para buscar en su catálogo.".into(),
        );
    }
    if query.chars().count() < 2 || query.chars().count() > 200 {
        return Err("Escribe entre 2 y 200 caracteres para buscar en Jamendo.".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("No se pudo preparar la búsqueda de Jamendo: {error}"))?;
    let response = client
        .get("https://api.jamendo.com/v3.0/tracks/")
        .query(&[
            ("client_id", client_id.trim()),
            ("format", "json"),
            ("limit", "30"),
            ("offset", "0"),
            ("namesearch", query),
            ("type", "single albumtrack"),
            ("audioformat", "mp31"),
            ("imagesize", "300"),
        ])
        .send()
        .await
        .map_err(|error| format!("No se pudo buscar en el catálogo de Jamendo: {error}"))?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Jamendo devolvió una respuesta de búsqueda inválida: {error}"))?;
    if !status.is_success() {
        let message = body
            .pointer("/headers/error_message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Comprueba tu Client ID de Jamendo e inténtalo de nuevo.");
        log::error!("La búsqueda del catálogo de Jamendo respondió con HTTP {status}.");
        return Err(format!(
            "Jamendo rechazó la búsqueda (HTTP {status}): {message}"
        ));
    }
    parse_jamendo_search_page(&body)
}

#[tauri::command]
fn spotify_disconnect() -> Result<(), String> {
    delete_spotify_session()
}

#[cfg(test)]
mod tests {
    use super::{
        decode_query_value, parse_access_token, parse_jamendo_search_page,
        parse_spotify_search_page, query_value, spotify_error_message, spotify_search_params,
        spotify_skip_endpoint,
    };

    #[test]
    fn maps_only_supported_spotify_skip_directions() {
        assert_eq!(spotify_skip_endpoint("next"), Ok("/me/player/next"));
        assert_eq!(
            spotify_skip_endpoint("previous"),
            Ok("/me/player/previous")
        );
        assert!(spotify_skip_endpoint("random").is_err());
    }

    #[test]
    fn decodes_oauth_query_values() {
        assert_eq!(
            decode_query_value("code%2Bvalue%2Fmore"),
            Some("code+value/more".into())
        );
        assert_eq!(
            decode_query_value("scope=email+profile"),
            Some("scope=email profile".into())
        );
        assert_eq!(decode_query_value("%GG"), None);
    }

    #[test]
    fn finds_requested_oauth_parameter() {
        assert_eq!(
            query_value("state=csrf&code=abc%2F123", "code"),
            Some("abc/123".into())
        );
        assert_eq!(
            query_value("state=csrf&code=abc", "state"),
            Some("csrf".into())
        );
        assert_eq!(query_value("state=csrf", "code"), None);
    }

    #[test]
    fn maps_spotify_tracks_and_paginates_catalog_results() {
        let response = serde_json::json!({
            "tracks": {
                "total": 120,
                "items": [{
                    "id": "track-id",
                    "name": "Song title",
                    "duration_ms": 184500,
                    "artists": [{"name": "Artist one"}, {"name": "Artist two"}],
                    "album": {
                        "name": "Album title",
                        "images": [{"url": "https://i.scdn.co/image/artwork"}]
                    }
                }]
            }
        });
        let page = parse_spotify_search_page(&response, 50).expect("valid Spotify response");

        assert_eq!(page.total, 120);
        assert_eq!(page.offset, 50);
        assert_eq!(page.next_offset, Some(51));
        assert_eq!(page.tracks.len(), 1);
        assert_eq!(page.tracks[0].title, "Song title");
        assert_eq!(page.tracks[0].artist, "Artist one, Artist two");
        assert_eq!(page.tracks[0].duration, 184);
        assert_eq!(
            page.tracks[0].url,
            "https://open.spotify.com/track/track-id"
        );
        assert_eq!(
            serde_json::to_value(&page).expect("serializable Spotify page")["nextOffset"],
            51
        );
    }

    #[test]
    fn stops_catalog_pagination_at_spotify_limit() {
        let response = serde_json::json!({
            "tracks": {
                "total": 1200,
                "items": [{}, {}, {}]
            }
        });
        let page = parse_spotify_search_page(&response, 999).expect("valid Spotify response");
        assert_eq!(page.next_offset, None);
    }

    #[test]
    fn sends_spotify_search_parameters_with_track_type() {
        let params = spotify_search_params("Björk & friends", 50);
        assert_eq!(
            params,
            [
                ("q", "Björk & friends".to_owned()),
                ("type", "track".to_owned()),
                ("limit", "10".to_owned()),
                ("offset", "50".to_owned()),
            ]
        );
    }

    #[test]
    fn accepts_only_valid_bearer_access_tokens() {
        let token = serde_json::json!({
            "access_token": "access",
            "token_type": "Bearer",
            "expires_in": 3600
        });
        assert_eq!(
            parse_access_token(&token).expect("valid token"),
            ("access".into(), 3600)
        );

        let invalid_type = serde_json::json!({
            "access_token": "access",
            "token_type": "Basic",
            "expires_in": 3600
        });
        assert!(parse_access_token(&invalid_type).is_err());
    }

    #[test]
    fn preserves_spotify_api_error_details() {
        let response = serde_json::json!({
            "error": { "status": 400, "message": "Invalid search query" }
        });
        assert_eq!(
            spotify_error_message(&response),
            Some("Invalid search query")
        );
    }

    #[test]
    fn maps_jamendo_tracks_and_handles_singles() {
        let response = serde_json::json!({
            "headers": { "status": "success" },
            "results": [{
                "id": 123,
                "name": "Open Song",
                "artist_name": "Independent Artist",
                "album_name": "",
                "duration": 215,
                "image": "https://usercontent.jamendo.com/image.jpg",
                "audio": "https://prod-1.storage.jamendo.com/track.mp3",
                "shareurl": "https://www.jamendo.com/track/123"
            }]
        });
        let page = parse_jamendo_search_page(&response).expect("valid Jamendo response");

        assert_eq!(page.tracks.len(), 1);
        assert_eq!(page.tracks[0].id, "123");
        assert_eq!(page.tracks[0].title, "Open Song");
        assert_eq!(page.tracks[0].album, "Sencillo");
        assert_eq!(page.tracks[0].url, "https://www.jamendo.com/track/123");
        assert_eq!(
            serde_json::to_value(&page).expect("serializable Jamendo page")["tracks"][0]["audioUrl"],
            "https://prod-1.storage.jamendo.com/track.mp3"
        );
    }

    #[test]
    fn surfaces_jamendo_api_errors() {
        let response = serde_json::json!({
            "headers": {
                "status": "failed",
                "error_message": "Invalid client_id"
            },
            "results": []
        });
        assert_eq!(
            parse_jamendo_search_page(&response).unwrap_err(),
            "La API de Jamendo devolvió un error: Invalid client_id"
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_oauth_callback,
            exchange_oauth_code,
            spotify_get_account,
            spotify_get_playback_token,
            spotify_get_top_tracks,
            spotify_start_playback,
            spotify_set_playback_option,
            spotify_skip_track,
            spotify_search_tracks,
            spotify_search_catalog,
            spotify_get_artist,
            spotify_get_album,
            spotify_get_top_artists,
            spotify_get_new_releases,
            lyrics_get,
            spotify_build_radio,
            jamendo_search_tracks,
            spotify_disconnect,
            visualizer::visualizer_start,
            visualizer::visualizer_stop
        ])
        .manage(visualizer::Visualizer::default())
        .setup(|app| {
            // Actualizaciones automáticas: la app busca versiones nuevas firmadas en GitHub.
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
