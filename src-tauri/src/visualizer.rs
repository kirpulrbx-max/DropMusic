//! Visualizador de Pulso: escucha lo que suena en la PC (captura "loopback" de la salida de
//! audio de Windows) y manda al frontend la energía por bandas unas 30 veces por segundo.
//! Spotify reproduce con DRM dentro de su iframe y ya no da el análisis de ritmo a apps nuevas,
//! así que esta es la única forma de que el visualizador siga la canción de verdad.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{FftPlanner, num_complex::Complex};
use serde::Serialize;
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};

pub const BANDS: usize = 32;
const FFT_SIZE: usize = 2048;
const FRAME: Duration = Duration::from_millis(33);

#[derive(Default)]
pub struct Visualizer {
    running: Arc<AtomicBool>,
    // Cada inicio tiene su número: un hilo viejo que todavía no terminó no puede seguir emitiendo.
    session: Arc<AtomicU64>,
}

#[derive(Clone, Serialize)]
struct Levels {
    bands: Vec<f32>,
    level: f32,
    bass: f32,
    beat: bool,
}

#[tauri::command]
pub fn visualizer_start(app: AppHandle, state: State<'_, Visualizer>) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let running = state.running.clone();
    let session = state.session.fetch_add(1, Ordering::SeqCst) + 1;
    let current = state.session.clone();
    thread::spawn(move || {
        if let Err(error) = capture(&app, &running, session, &current) {
            log::warn!("No se pudo escuchar el audio para el visualizador: {error}");
            let _ = app.emit("visualizer-error", error);
        }
        if current.load(Ordering::SeqCst) == session {
            running.store(false, Ordering::SeqCst);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn visualizer_stop(state: State<'_, Visualizer>) {
    state.running.store(false, Ordering::SeqCst);
}

fn capture(app: &AppHandle, running: &AtomicBool, session: u64, current: &AtomicU64) -> Result<(), String> {
    let host = cpal::default_host();
    // En Windows, abrir como entrada el dispositivo de salida activa la captura "loopback".
    let device = host
        .default_output_device()
        .ok_or("No hay un dispositivo de salida de audio.")?;
    let config = device
        .default_output_config()
        .map_err(|error| format!("No se pudo leer la configuración de audio: {error}"))?;
    let sample_rate = config.sample_rate().0 as f32;
    let channels = usize::from(config.channels().max(1));
    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(FFT_SIZE * 4)));

    let push = {
        let samples = samples.clone();
        move |mono: &mut dyn Iterator<Item = f32>| {
            if let Ok(mut buffer) = samples.lock() {
                buffer.extend(mono);
                let excess = buffer.len().saturating_sub(FFT_SIZE * 4);
                if excess > 0 {
                    buffer.drain(..excess);
                }
            }
        }
    };
    let on_error = |error| log::warn!("Error en la captura de audio: {error}");
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let push = push.clone();
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[f32], _| push(&mut data.chunks(channels).map(|frame| frame.iter().sum::<f32>() / channels as f32)),
                on_error,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let push = push.clone();
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[i16], _| {
                    push(&mut data.chunks(channels).map(|frame| frame.iter().map(|&s| f32::from(s) / 32768.0).sum::<f32>() / channels as f32))
                },
                on_error,
                None,
            )
        }
        format => return Err(format!("Formato de audio no soportado: {format}")),
    }
    .map_err(|error| format!("No se pudo abrir la captura de audio: {error}"))?;
    stream
        .play()
        .map_err(|error| format!("No se pudo iniciar la captura de audio: {error}"))?;

    let fft = FftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);
    let window: Vec<f32> = (0..FFT_SIZE)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos())
        .collect();
    let edges = band_edges(sample_rate);
    let mut smooth = vec![0.0_f32; BANDS];
    let mut peak = 1e-3_f32;
    let mut bass_average = 0.0_f32;
    let mut beat_cooldown = 0_u32;
    let mut buffer = vec![Complex::new(0.0, 0.0); FFT_SIZE];

    while running.load(Ordering::SeqCst) && current.load(Ordering::SeqCst) == session {
        thread::sleep(FRAME);
        let latest: Vec<f32> = match samples.lock() {
            Ok(data) if data.len() >= FFT_SIZE => data[data.len() - FFT_SIZE..].to_vec(),
            _ => vec![0.0; FFT_SIZE],
        };
        for (slot, (sample, weight)) in buffer.iter_mut().zip(latest.iter().zip(&window)) {
            *slot = Complex::new(sample * weight, 0.0);
        }
        fft.process(&mut buffer);

        let mut raw = [0.0_f32; BANDS];
        for (band, value) in raw.iter_mut().enumerate() {
            let (start, end) = (edges[band], edges[band + 1].max(edges[band] + 1));
            let energy = buffer[start..end].iter().map(|c| c.norm()).fold(0.0_f32, f32::max);
            // Escala logarítmica: así los agudos suaves también se ven.
            *value = (1.0 + energy).ln();
        }
        let frame_peak = raw.iter().copied().fold(0.0_f32, f32::max);
        // Normaliza con un pico que baja despacio: funciona igual con volumen alto o bajo.
        peak = (peak * 0.995).max(frame_peak).max(1e-3);
        for (smoothed, value) in smooth.iter_mut().zip(raw) {
            let target = (value / peak).clamp(0.0, 1.0);
            // Sube rápido y baja despacio, como un ecualizador de verdad.
            *smoothed = if target > *smoothed { target } else { *smoothed * 0.82 + target * 0.18 };
        }
        let bass = smooth[..4].iter().sum::<f32>() / 4.0;
        let level = smooth.iter().sum::<f32>() / BANDS as f32;
        bass_average = bass_average * 0.95 + bass * 0.05;
        beat_cooldown = beat_cooldown.saturating_sub(1);
        let beat = beat_cooldown == 0 && bass > 0.35 && bass > bass_average * 1.25;
        if beat {
            beat_cooldown = 7;
        }
        let _ = app.emit(
            "visualizer-levels",
            Levels { bands: smooth.clone(), level, bass, beat },
        );
    }
    drop(stream);
    Ok(())
}

/// Bordes de las bandas (en índices del FFT), repartidas en escala logarítmica de 40 Hz a 16 kHz.
fn band_edges(sample_rate: f32) -> Vec<usize> {
    let (low, high) = (40.0_f32, 16_000.0_f32.min(sample_rate / 2.0));
    (0..=BANDS)
        .map(|i| {
            let frequency = low * (high / low).powf(i as f32 / BANDS as f32);
            ((frequency / sample_rate * FFT_SIZE as f32) as usize).clamp(1, FFT_SIZE / 2)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn band_edges_grow_and_stay_in_range() {
        let edges = band_edges(48_000.0);
        assert_eq!(edges.len(), BANDS + 1);
        assert!(edges.windows(2).all(|pair| pair[0] <= pair[1]));
        assert!(*edges.last().unwrap() <= FFT_SIZE / 2);
    }
}
