// Ajustes públicos de la web de DropMusic. Nada de esto es secreto: la clave anónima de Supabase
// y el Client ID de PayPal están hechos para usarse en el navegador. El Secret de PayPal va solo
// en el servidor (Supabase > Edge Functions > Secrets), nunca aquí.
window.DROPMUSIC_CONFIG = {
  supabaseUrl: 'https://alfwqwswpayzipgkmzut.supabase.co',
  supabaseAnonKey: 'sb_publishable_9KMm7w2jHJb_MHyO6-4Qyw_ZQ4x6ZLo',
  paypalClientId: 'BAApWt-aNzDSiw2an1sSBU8YOninQwAu2gTkI1FW-xA_ArI4BVIjIokGjM84gNNSwdgO0YxjHAc8p6QBbE',
  proPrice: '5.00',
}
