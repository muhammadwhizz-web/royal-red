import type { MetadataRoute } from 'next'

// PWA manifest: fixes the recurring /manifest.json 404 and lays the
// installable-app groundwork for the packaged Linux build (Phase 7).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AWON / OS within OS',
    short_name: 'AWON',
    description:
      'AWON is a Linux-native agent operating system: it builds complete websites and apps, researches the web, manages accounts, and verifies every deliverable to 10/10.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      {
        src: '/logo.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  }
}
