import { useEffect, useRef } from 'react'
import { ShoppingCart } from 'lucide-react'

const cartMarks = [
  { top: '8%', left: '4%', size: 34, delay: '0s', duration: '13s', opacity: 0.09 },
  { top: '16%', left: '10%', size: 30, delay: '0.7s', duration: '12.2s', opacity: 0.08 },
  { top: '28%', left: '6%', size: 40, delay: '1.3s', duration: '14.6s', opacity: 0.09 },
  { top: '40%', left: '12%', size: 28, delay: '2.1s', duration: '12.8s', opacity: 0.07 },
  { top: '55%', left: '5%', size: 44, delay: '1.6s', duration: '15.1s', opacity: 0.09 },
  { top: '68%', left: '11%', size: 32, delay: '0.9s', duration: '13.5s', opacity: 0.08 },
  { top: '82%', left: '7%', size: 36, delay: '2.4s', duration: '14.2s', opacity: 0.08 },
  { top: '10%', left: '90%', size: 38, delay: '0.4s', duration: '15s', opacity: 0.09 },
  { top: '22%', left: '84%', size: 30, delay: '1.2s', duration: '13.4s', opacity: 0.08 },
  { top: '36%', left: '92%', size: 42, delay: '1.8s', duration: '16s', opacity: 0.09 },
  { top: '50%', left: '86%', size: 29, delay: '2.6s', duration: '12.9s', opacity: 0.07 },
  { top: '64%', left: '93%', size: 35, delay: '1.9s', duration: '16.2s', opacity: 0.08 },
  { top: '77%', left: '87%', size: 33, delay: '0.8s', duration: '13.8s', opacity: 0.08 },
  { top: '88%', left: '91%', size: 31, delay: '2.2s', duration: '14.4s', opacity: 0.08 },
]

const glowNodes = [
  { top: '12%', left: '8%', size: 9, delay: '0.2s', duration: '4.6s' },
  { top: '24%', left: '14%', size: 8, delay: '1.1s', duration: '5.2s' },
  { top: '42%', left: '9%', size: 12, delay: '0.5s', duration: '4.8s' },
  { top: '58%', left: '15%', size: 10, delay: '1.6s', duration: '5.6s' },
  { top: '78%', left: '12%', size: 11, delay: '2.1s', duration: '4.9s' },
  { top: '14%', left: '88%', size: 8, delay: '0.9s', duration: '4.4s' },
  { top: '30%', left: '84%', size: 10, delay: '1.8s', duration: '5.4s' },
  { top: '48%', left: '91%', size: 9, delay: '0.3s', duration: '4.7s' },
  { top: '66%', left: '86%', size: 13, delay: '2.3s', duration: '5.8s' },
  { top: '86%', left: '90%', size: 9, delay: '1.4s', duration: '4.5s' },
  { top: '52%', left: '18%', size: 7, delay: '1.9s', duration: '4.3s' },
  { top: '36%', left: '82%', size: 7, delay: '0.6s', duration: '4.9s' },
]

const parseRgbToken = (value: string, fallback: [number, number, number]): [number, number, number] => {
  const parts = value.trim().split(/\s+/).map((part) => Number(part))
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return fallback
  return [parts[0], parts[1], parts[2]]
}

export function MeshGradient({ mode = 'dynamic' }: { mode?: 'dynamic' | 'calm' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isCalm = mode === 'calm'

  useEffect(() => {
    if (isCalm) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number | null = null
    let time = 0

    const rootStyles = getComputedStyle(document.documentElement)
    const tokens = ['--decor-rgb-1', '--decor-rgb-2', '--decor-rgb-3', '--decor-rgb-4', '--decor-rgb-5'] as const
    const fallbackRgb: Array<[number, number, number]> = [
      [16, 185, 129],
      [13, 148, 136],
      [245, 158, 11],
      [251, 113, 133],
      [20, 184, 166],
    ]
    const colors = tokens.map((token, index) => {
      const [r, g, b] = parseRgbToken(rootStyles.getPropertyValue(token), fallbackRgb[index])
      return { r, g, b }
    })

    // Floating orbs
    const orbs = Array.from({ length: 3 }, (_, i) => ({
      x: Math.random() * (window.innerWidth || 800),
      y: Math.random() * (window.innerHeight || 600),
      radius: 160 + Math.random() * 220,
      speed: 0.00035 + Math.random() * 0.00055,
      color: colors[i % colors.length],
      offsetX: Math.random() * 1000,
      offsetY: Math.random() * 1000,
    }))

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    resize()
    window.addEventListener('resize', resize)

    const drawFrame = () => {
      time += 1
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Create mesh gradient effect
      orbs.forEach((orb, i) => {
        const x = orb.x + Math.sin(time * orb.speed + orb.offsetX) * 70
        const y = orb.y + Math.cos(time * orb.speed + orb.offsetY) * 70

        const gradient = ctx.createRadialGradient(x, y, 0, x, y, orb.radius)
        
        const alpha1 = 0.08 + Math.sin(time * 0.01 + i) * 0.025
        const alpha2 = 0.03 + Math.sin(time * 0.01 + i) * 0.012
        
        gradient.addColorStop(0, `rgba(${orb.color.r}, ${orb.color.g}, ${orb.color.b}, ${alpha1})`)
        gradient.addColorStop(0.5, `rgba(${orb.color.r}, ${orb.color.g}, ${orb.color.b}, ${alpha2})`)
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')

        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      })

      animationId = requestAnimationFrame(drawFrame)
    }

    drawFrame()

    return () => {
      window.removeEventListener('resize', resize)
      if (animationId !== null) {
        cancelAnimationFrame(animationId)
      }
    }
  }, [isCalm])

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <div className={`decor-gradient-calm absolute inset-0 transition-opacity duration-500 ${isCalm ? 'opacity-100' : 'opacity-0'}`} />
      <canvas
        ref={canvasRef}
        className={`decor-gradient-canvas absolute inset-0 h-full w-full transition-[opacity,filter] duration-500 ${isCalm ? 'opacity-0' : 'opacity-[0.7] saturate-[0.72]'}`}
      />

      <div className={`overlay-scrim-soft absolute inset-0 transition-opacity duration-500 ${isCalm ? 'opacity-0' : 'opacity-100'}`} />

      <div className="absolute inset-0">
        {!isCalm && cartMarks.map((mark, index) => (
          <div
            key={`cart-${index}`}
            className="decor-glyph absolute"
            style={{
              top: mark.top,
              left: mark.left,
              opacity: mark.opacity * 0.65,
              animation: `cart-float ${mark.duration} ease-in-out ${mark.delay} infinite`,
            }}
          >
            <ShoppingCart size={mark.size} strokeWidth={1.8} />
          </div>
        ))}

        {!isCalm && glowNodes.map((node, index) => (
          <span
            key={`node-${index}`}
            className="decor-node absolute rounded-full blur-[1px]"
            style={{
              top: node.top,
              left: node.left,
              width: `${node.size}px`,
              height: `${node.size}px`,
              animation: `node-glow ${node.duration} ease-in-out ${node.delay} infinite`,
              boxShadow: '0 0 12px rgba(52, 211, 153, 0.48)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
