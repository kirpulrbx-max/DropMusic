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

  // El botón de descarga apunta al instalador de la última versión (si GitHub responde)
  fetch('https://api.github.com/repos/kirpulrbx-max/DropMusic/releases/latest')
    .then((response) => (response.ok ? response.json() : null))
    .then((release) => {
      if (!release) return
      const installer = (release.assets || []).find((asset) => /setup\.exe$/i.test(asset.name))
      if (!installer) return
      document.querySelectorAll('#descargar [data-download]').forEach((link) => {
        link.href = installer.browser_download_url
      })
      const meta = document.getElementById('download-meta')
      const size = (installer.size / 1024 / 1024).toFixed(1)
      if (meta) meta.textContent = `Versión ${release.tag_name.replace(/^v/, '')} · Instalador para Windows (64 bits) · ${size} MB`
    })
    .catch(() => {})
})()
