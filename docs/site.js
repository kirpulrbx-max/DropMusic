// Comportamiento del sitio: aparición al hacer scroll, barras del ejemplo de Pulso
// y enlace de descarga directo al instalador de la última versión publicada en GitHub.
(() => {
  const year = document.getElementById('year')
  if (year) year.textContent = String(new Date().getFullYear())

  // Secciones que aparecen suavemente al entrar en pantalla
  const items = document.querySelectorAll('.reveal')
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('visible')
        observer.unobserve(entry.target)
      }
    }, { threshold: 0.12 })
    items.forEach((item) => observer.observe(item))
  } else {
    items.forEach((item) => item.classList.add('visible'))
  }

  // Anillo de barras del ejemplo de Pulso
  const pulse = document.getElementById('art-pulse')
  if (pulse) {
    for (let index = 0; index < 32; index++) {
      const bar = document.createElement('i')
      bar.style.setProperty('--r', `${index * 11.25}deg`)
      bar.style.animationDelay = `${-((index * 137) % 700)}ms`
      pulse.appendChild(bar)
    }
  }

  // Botón para copiar el Redirect URI de la guía de Spotify
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => {
      const text = document.getElementById(button.dataset.copy)?.textContent ?? ''
      navigator.clipboard?.writeText(text).then(() => {
        button.textContent = 'Copiado'
        setTimeout(() => { button.textContent = 'Copiar' }, 1600)
      })
    })
  })

  // Enlace de la beta de iPhone cuando exista (TestFlight no se publica en GitHub).
  const IOS_TESTFLIGHT_URL = ''

  // Cada plataforma se activa sola cuando la última versión de GitHub trae su instalador.
  const assetPatterns = {
    windows: /setup\.exe$/i,
    macos: /\.dmg$/i,
    linux: /\.(AppImage|deb)$/i,
    android: /^(?!.*tv).*\.apk$/i,
    tv: /tv.*\.apk$/i,
  }

  function enable(key, url, label) {
    const link = document.querySelector('[data-asset-link="' + key + '"]')
    if (!link) return
    link.href = url
    link.textContent = label
    link.removeAttribute('aria-disabled')
    link.removeAttribute('tabindex')
    link.classList.replace('button-ghost', 'button-primary')
    link.closest('li')?.classList.add('is-available')
  }

  if (IOS_TESTFLIGHT_URL) enable('ios', IOS_TESTFLIGHT_URL, 'Unirme a la beta')

  fetch('https://api.github.com/repos/kirpulrbx-max/DropMusic/releases/latest')
    .then((response) => (response.ok ? response.json() : null))
    .then((release) => {
      if (!release) return
      const assets = release.assets || []
      for (const [key, pattern] of Object.entries(assetPatterns)) {
        const asset = assets.find((item) => pattern.test(item.name))
        if (asset) enable(key, asset.browser_download_url, 'Descargar')
      }
      const windows = assets.find((item) => assetPatterns.windows.test(item.name))
      if (windows) {
        // El botón grande de la portada descarga directo el instalador de Windows
        document.querySelectorAll('.hero [data-download]').forEach((link) => { link.href = windows.browser_download_url })
      }
      const meta = document.getElementById('download-meta')
      if (meta) meta.innerHTML = 'Versión ' + release.tag_name.replace(/^v/, '') + ' · Todas las versiones en <a href="https://github.com/kirpulrbx-max/DropMusic/releases">GitHub Releases</a>.'
    })
    .catch(() => {})
})()
