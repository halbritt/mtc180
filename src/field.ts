import {
  Box3,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  CSS2DObject,
  CSS2DRenderer,
} from 'three/addons/renderers/CSS2DRenderer.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { PracticeTarget } from './physics/practice'
import type { Sample, Target } from './physics/telemetry'

type View = 'orbit' | 'side' | 'overhead' | 'downrange'
const directions: Record<View, Vector3> = {
  orbit: new Vector3(-0.55, 0.64, 1),
  side: new Vector3(0, 0, 1),
  overhead: new Vector3(0, 1, 0.00001),
  downrange: new Vector3(-1, 0.085, 0),
}
type Position = Pick<Sample, 'x' | 'y' | 'z'>

// Surveyed coordinates use z up. Center the WebGL field on the release in x and y.
function fieldPosition(point: Position, origin: Target, out = new Vector3()) {
  return out.set(point.x - origin.x, point.z, origin.y - point.y)
}

const carryColor = 0xbcffd6
const rollColor = 0xffbc6b

function ribbon(group: Group, points: Vector3[], color: number, width: number) {
  if (points.length < 2) return
  const geometry = new LineGeometry()
  geometry.setPositions(points.flatMap((p) => p.toArray()))
  const material = new LineMaterial({ color, depthTest: false })
  material.linewidth = width
  const line = new Line2(geometry, material)
  line.renderOrder = 1
  group.add(line)
}

function dot(group: Group, point: Vector3, color: number, size: number) {
  const geometry = new BufferGeometry().setFromPoints([point])
  const material = new PointsMaterial({
    color,
    size,
    sizeAttenuation: false,
    depthTest: false,
  })
  const marker = new Points(geometry, material)
  marker.renderOrder = 2
  group.add(marker)
}

function label(group: Group, point: Vector3, text: string, color: string) {
  const element = document.createElement('div')
  element.className = 'field-label'
  const caption = document.createElement('span')
  caption.textContent = text
  Object.assign(caption.style, {
    display: 'block',
    padding: '3px 6px',
    borderRadius: '3px',
    background: '#102e29',
    color,
    whiteSpace: 'nowrap',
    font: '600 11px/1.35 system-ui, sans-serif',
    fontVariantNumeric: 'tabular-nums',
  })
  element.append(caption)
  const anchor = new CSS2DObject(element)
  anchor.position.copy(point)
  group.add(anchor)
  return { anchor, caption }
}

// Place close-together contact and rest labels on opposite sides of their marks.
function arrangeLabels(
  labels: ReturnType<typeof label>[],
  camera: OrthographicCamera,
  w: number,
  h: number
) {
  const placed: { x: number; y: number; width: number; height: number }[] = []
  for (const { anchor, caption } of labels) {
    const p = anchor.getWorldPosition(new Vector3()).project(camera)
    const px = ((1 + p.x) * w) / 2,
      py = ((1 - p.y) * h) / 2
    const width = caption.offsetWidth,
      height = caption.offsetHeight
    caption.style.visibility = 'hidden'
    if (px < 0 || px > w || py < 0 || py > h || p.z < -1 || p.z > 1) continue
    const gap = height + 6
    const offsets = [-height - 8, 8]
    for (let level = 1; level <= 3; level++) {
      offsets.push(-height - 8 - level * gap, 8 + level * gap)
    }
    for (const dy of offsets) {
      const x = Math.max(4, Math.min(px - width / 2, w - width - 4)),
        y = py + dy
      if (y < 2 || y + height > h - 2) continue
      if (
        placed.some(
          (r) =>
            x < r.x + r.width + 3 &&
            x + width + 3 > r.x &&
            y < r.y + r.height + 3 &&
            y + height + 3 > r.y
        )
      )
        continue
      caption.style.transform = `translate(${x - px + width / 2}px,${
        dy + height / 2
      }px)`
      caption.style.visibility = 'visible'
      placed.push({ x, y, width, height })
      break
    }
  }
}

function disposeContents(group: Group) {
  group.traverse((obj) => {
    if (obj instanceof CSS2DObject) obj.element.remove()
    if (
      obj instanceof Mesh ||
      obj instanceof Points ||
      obj instanceof GridHelper
    ) {
      obj.geometry.dispose()
      const materials = Array.isArray(obj.material)
        ? obj.material
        : [obj.material]
      for (const material of materials) material.dispose()
    }
  })
  group.clear()
}

function drawGround(group: Group, bounds: Box3) {
  const size = bounds.getSize(new Vector3())
  const span = Math.max(1, size.x, size.z, size.y)
  const center = bounds.getCenter(new Vector3())
  const stepBase = 10 ** Math.floor(Math.log10(span / 8))
  const stepFactor = span / (8 * stepBase)
  const step =
    stepBase *
    (stepFactor > 5 ? 10 : stepFactor > 2 ? 5 : stepFactor > 1 ? 2 : 1)
  const grid = new GridHelper(32 * step, 32, 0x638e76, 0x446f59)
  grid.position.set(
    Math.round(center.x / step) * step,
    0,
    Math.round(center.z / step) * step
  )
  group.add(grid)
  // Alternating strips are field markings. Their width matches one grid interval.
  const groundGeometry = new PlaneGeometry(
    step * 32,
    step * 32,
    32,
    1
  ).toNonIndexed()
  const grass: number[] = []
  const turfColors = [new Color(0x285442), new Color(0x2b5846)]
  for (let i = 0; i < groundGeometry.getAttribute('position').count; i++) {
    grass.push(...turfColors[Math.floor(i / 6) % 2].toArray())
  }
  groundGeometry.setAttribute('color', new Float32BufferAttribute(grass, 3))
  const ground = new Mesh(
    groundGeometry,
    new MeshBasicMaterial({ vertexColors: true })
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.copy(grid.position)
  ground.position.y -= step * 0.005
  group.add(ground)
}

function drawFootprint(group: Group, practice: PracticeTarget, bounds: Box3) {
  const point = (dx: number, dy: number) =>
    new Vector3(practice.x + dx, 0, -(practice.y + dy))
  // Vertices wind upwards on the x/z ground plane. Both target shapes are convex.
  let outline: Vector3[]
  if (practice.shape === 'circle') {
    const radius = practice.radius
    outline = Array.from({ length: 64 }, (_, i) => {
      const angle = (2 * Math.PI * i) / 64
      return point(radius * Math.cos(angle), radius * Math.sin(angle))
    })
  } else {
    const x = practice.length / 2
    const y = practice.width / 2
    outline = [point(-x, -y), point(x, -y), point(x, y), point(-x, y)]
  }
  for (const vertex of outline) bounds.expandByPoint(vertex)
  const geometry = new BufferGeometry().setFromPoints(outline)
  const triangles: number[] = []
  for (let i = 1; i < outline.length - 1; i++) triangles.push(0, i, i + 1)
  geometry.setIndex(triangles)
  const fill = new MeshBasicMaterial({
    color: 0xa6c7ff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  group.add(new Mesh(geometry, fill))
  ribbon(group, [...outline, outline[0]], 0xa6c7ff, 2)
}

export function createField(host: HTMLElement) {
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const overlay = new CSS2DRenderer()
  for (const el of [renderer.domElement, overlay.domElement]) {
    Object.assign(el.style, { position: 'absolute', inset: '0' })
  }
  overlay.domElement.style.pointerEvents = 'none'
  renderer.domElement.setAttribute(
    'aria-label',
    'Recorded flight and ground track'
  )
  renderer.domElement.setAttribute('role', 'img')
  const ball = document.createElement('div')
  ball.className = 'field-ball'
  ball.setAttribute('aria-hidden', 'true')
  ball.hidden = true
  host.append(renderer.domElement, ball, overlay.domElement)

  const scene = new Scene()
  scene.background = new Color(0x183b34)
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.001, 100)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.maxPolarAngle = Math.PI / 2
  controls.minZoom = 0.25
  controls.maxZoom = 32

  const content = new Group()
  const groundAndTarget = new Group()
  scene.add(content, groundAndTarget)
  const traceBounds = new Box3()
  let traceTarget: Vector3 | undefined
  let targetLabel: ReturnType<typeof label> | undefined
  let targetLabelIndex = 0
  let origin: Target | undefined
  const ballPosition = new Vector3()
  const projected = new Vector3()
  let viewportWidth = 1,
    viewportHeight = 1
  const labels: ReturnType<typeof label>[] = []
  const bounds = new Box3().setFromPoints([
    new Vector3(-1, 0, -1),
    new Vector3(1, 1, 1),
  ])
  let activeView: View = 'orbit'
  let pending = 0
  let framedWidth = 2,
    framedHeight = 2

  function projectCursor() {
    if (!origin) return
    projected.copy(ballPosition).project(camera)
    ball.hidden = Math.abs(projected.z) > 1
    const x = ((projected.x + 1) * viewportWidth) / 2 - 7
    const y = ((1 - projected.y) * viewportHeight) / 2 - 7
    ball.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  function render() {
    pending = 0
    renderer.render(scene, camera)
    overlay.render(scene, camera)
    arrangeLabels(labels, camera, viewportWidth, viewportHeight)
    projectCursor()
  }
  function invalidate() {
    if (!pending) pending = requestAnimationFrame(render)
  }
  controls.addEventListener('change', invalidate)

  function resize() {
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight)
    viewportWidth = width
    viewportHeight = height
    renderer.setSize(width, height)
    overlay.setSize(width, height)
    // Keep the full preset framing when a wide plot becomes a tall, narrow one.
    const aspect = width / height
    camera.top = Math.max(framedHeight, framedWidth / aspect)
    camera.bottom = -camera.top
    camera.right = camera.top * aspect
    camera.left = -camera.right
    camera.updateProjectionMatrix()
    invalidate()
  }

  function view(mode: View) {
    activeView = mode
    const center = bounds.getCenter(new Vector3())
    const extent = bounds.getSize(new Vector3())
    const radius = Math.max(extent.length() / 2, 0.5)
    controls.target.copy(center)
    camera.position
      .copy(center)
      .addScaledVector(directions[mode].clone().normalize(), 6 * radius)
    camera.near = radius / 1000
    camera.far = radius * 100
    camera.zoom = 1
    controls.update()
    camera.updateMatrixWorld()
    // Fit the projected bounds for this view; a side profile is usually much wider than tall.
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    const halfExtentAlong = (v: Vector3) =>
      (Math.abs(v.x) * extent.x +
        Math.abs(v.y) * extent.y +
        Math.abs(v.z) * extent.z) /
      2
    framedWidth = Math.max(halfExtentAlong(right), radius * 0.15) * 1.35
    framedHeight = Math.max(halfExtentAlong(up), radius * 0.15) * 1.35
    resize()
  }

  function clear() {
    disposeContents(content)
    disposeContents(groundAndTarget)
    traceTarget = undefined
    targetLabel = undefined
    labels.length = 0
    origin = undefined
    ball.hidden = true
  }

  function setCursor(point: Position) {
    if (!origin) return
    fieldPosition(point, origin, ballPosition)
    projectCursor()
  }

  function setPractice(practice?: PracticeTarget) {
    if (!origin) return
    disposeContents(groundAndTarget)
    if (targetLabel) labels.splice(targetLabelIndex, 1)
    targetLabel = undefined
    bounds.copy(traceBounds)
    const center = practice
      ? new Vector3(practice.x, 0, -practice.y)
      : traceTarget
    if (practice) drawFootprint(groundAndTarget, practice, bounds)
    if (center) {
      bounds.expandByPoint(center)
      dot(groundAndTarget, center, 0xa6c7ff, 7)
      targetLabel = label(
        groundAndTarget,
        center,
        practice ? 'Practice target' : 'Target',
        '#c3d7ff'
      )
      labels.splice(targetLabelIndex, 0, targetLabel)
    }
    drawGround(groundAndTarget, bounds)
    view(activeView)
  }

  function show(
    samples: readonly Sample[],
    target?: Target,
    practice?: PracticeTarget
  ) {
    clear()
    if (!samples.length) {
      invalidate()
      return
    }
    const start = samples[0]
    origin = { x: start.x, y: start.y }
    const path = samples.map((point) => fieldPosition(point, start))
    ballPosition.copy(path[0])
    traceTarget = target && fieldPosition({ ...target, z: 0 }, start)
    traceBounds.setFromPoints(path)
    traceBounds.expandByPoint(new Vector3(0, 0, 0))
    const contact = samples.findIndex((p) => p.event === 'contact')
    const afterFlight = contact < 0 ? path.length - 1 : contact
    ribbon(content, path.slice(0, afterFlight + 1), carryColor, 3.5)
    ribbon(content, path.slice(afterFlight), rollColor, 3.5)
    const last = path[path.length - 1]
    const distance = (p: Vector3) => Math.hypot(p.x, p.z).toFixed(2) + ' m'
    dot(content, last, 0xffdd9e, 8)
    labels.push(label(content, last, 'Rest · ' + distance(last), '#ffe0a5'))
    if (contact >= 0) {
      dot(content, path[contact], carryColor, 7)
      labels.push(
        label(
          content,
          path[contact],
          'Carry · ' + distance(path[contact]),
          '#ccffdf'
        )
      )
    }
    targetLabelIndex = labels.length
    let bounces = 0
    samples.forEach((s, i) => {
      if (i > contact && s.event === 'contact') {
        dot(content, path[i], rollColor, 6)
        labels.push(label(content, path[i], 'Bounce ' + ++bounces, '#ffe0a5'))
      }
    })
    dot(content, path[0], carryColor, 5)
    labels.push(label(content, path[0], 'Release', '#ccffdf'))
    setPractice(practice)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  view(activeView)
  return {
    show,
    view,
    setCursor,
    setPractice,
    dispose() {
      observer.disconnect()
      controls.dispose()
      cancelAnimationFrame(pending)
      clear()
      ball.remove()
      renderer.dispose()
      renderer.domElement.remove()
      overlay.domElement.remove()
    },
  }
}
