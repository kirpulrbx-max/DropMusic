// Modo local: las canciones que sube el usuario se guardan dentro de la app (IndexedDB),
// junto con sus datos y la portada que traen incrustada. Funciona igual en Windows, Android y TV,
// sin cuentas ni internet.
import { parseBlob } from 'music-metadata'

export type LocalTrackRecord = {
  id: string
  title: string
  artist: string
  album: string
  genre: string
  duration: number
  fileName: string
  size: number
  hasCover: boolean
  addedAt: number
}

export const localAudioExtensions = ['.mp3', '.flac', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.webm']

const DB_NAME = 'dropmusic-local'
const TRACKS = 'tracks'
const FILES = 'files'
const COVERS = 'covers'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const store of [TRACKS, FILES, COVERS]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la biblioteca local.'))
  })
  return dbPromise
}

function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar en la biblioteca local.'))
  })
}

function read<T>(store: string, key: string) {
  return openDb().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  }))
}

export async function listLocalTracks() {
  const db = await openDb()
  return new Promise<LocalTrackRecord[]>((resolve, reject) => {
    const request = db.transaction(TRACKS).objectStore(TRACKS).getAll()
    request.onsuccess = () => resolve((request.result as LocalTrackRecord[]).sort((a, b) => b.addedAt - a.addedAt))
    request.onerror = () => reject(request.error)
  })
}

export function isLocalAudioFile(file: File) {
  const name = file.name.toLowerCase()
  return file.type.startsWith('audio/') || localAudioExtensions.some((extension) => name.endsWith(extension))
}

// Si el archivo no trae etiquetas, intenta sacar "Artista - Título" del nombre.
function namesFromFile(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim()
  const [artist, ...rest] = base.split(' - ')
  return rest.length > 0 ? { artist: artist.trim(), title: rest.join(' - ').trim() } : { artist: '', title: base }
}

export async function importLocalFile(file: File): Promise<LocalTrackRecord> {
  const fallback = namesFromFile(file.name)
  let title = fallback.title
  let artist = fallback.artist
  let album = ''
  let genre = ''
  let duration = 0
  let cover: Blob | null = null
  try {
    const metadata = await parseBlob(file, { duration: true, skipCovers: false })
    const { common, format } = metadata
    title = common.title?.trim() || title
    artist = common.artists?.join(', ') || common.artist?.trim() || artist
    album = common.album?.trim() || album
    genre = common.genre?.[0]?.trim() || genre
    duration = Math.round(format.duration ?? 0)
    const picture = common.picture?.[0]
    if (picture) cover = new Blob([new Uint8Array(picture.data)], { type: picture.format || 'image/jpeg' })
  } catch (error) {
    // Archivos sin etiquetas o con formato raro: se guardan igual con los datos del nombre.
    console.warn(`No se pudieron leer las etiquetas de ${file.name}.`, error)
  }

  const record: LocalTrackRecord = {
    id: `local:${crypto.randomUUID()}`,
    title: title || 'Sin título',
    artist: artist || 'Artista desconocido',
    album: album || 'Canciones locales',
    genre: genre || 'Local',
    duration,
    fileName: file.name,
    size: file.size,
    hasCover: Boolean(cover),
    addedAt: Date.now(),
  }
  const db = await openDb()
  const transaction = db.transaction([TRACKS, FILES, COVERS], 'readwrite')
  transaction.objectStore(TRACKS).put(record, record.id)
  transaction.objectStore(FILES).put(file, record.id)
  if (cover) transaction.objectStore(COVERS).put(cover, record.id)
  await done(transaction)
  return record
}

export async function deleteLocalTrack(id: string) {
  const db = await openDb()
  const transaction = db.transaction([TRACKS, FILES, COVERS], 'readwrite')
  for (const store of [TRACKS, FILES, COVERS]) transaction.objectStore(store).delete(id)
  await done(transaction)
  revokeLocalUrls(id)
}

// Las URL de los blobs se crean una vez por canción y se reutilizan mientras la app está abierta.
const audioUrls = new Map<string, string>()
const coverUrls = new Map<string, string>()

export async function localAudioUrl(id: string) {
  const cached = audioUrls.get(id)
  if (cached) return cached
  const blob = await read<Blob>(FILES, id)
  if (!blob) throw new Error('Esta canción ya no está en tu biblioteca local.')
  const url = URL.createObjectURL(blob)
  audioUrls.set(id, url)
  return url
}

export async function localCoverUrl(id: string) {
  const cached = coverUrls.get(id)
  if (cached) return cached
  const blob = await read<Blob>(COVERS, id)
  if (!blob) return ''
  const url = URL.createObjectURL(blob)
  coverUrls.set(id, url)
  return url
}

function revokeLocalUrls(id: string) {
  for (const urls of [audioUrls, coverUrls]) {
    const url = urls.get(id)
    if (url) URL.revokeObjectURL(url)
    urls.delete(id)
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
