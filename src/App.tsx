import Fuse from 'fuse.js'
import Panzoom from '@panzoom/panzoom'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildIndexes,
  buildMainSet,
  buildScopedSet,
  formatLifeRange,
  fullName,
  getOrderedSpouseIds,
  getOldestPersonId,
} from './lib/family'
import { computeLayout, type Orientation } from './lib/layout'
import type { FamilyData, Person } from './types/family'

const MAX_SEARCH_RESULTS = 8
const DEFAULT_SCALE = 1
const MIN_SCALE = 0.1
const MAX_SCALE = 2
const FIT_PADDING = 48
const FIT_SAFETY = 0.92
type CenterRequest = { id: string; scale?: number; nonce: number } | null

function App() {
  const [data, setData] = useState<FamilyData | null>(null)
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null)
  const [scopedPersonId, setScopedPersonId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedPersonId, setHighlightedPersonId] = useState<string | null>(null)
  const [centerRequest, setCenterRequest] = useState<CenterRequest>(null)
  const [fitRequestNonce, setFitRequestNonce] = useState(0)
  const [panzoomReady, setPanzoomReady] = useState(false)
  const [orientation, setOrientation] = useState<Orientation>('vertical')

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const panzoomRef = useRef<ReturnType<typeof Panzoom> | null>(null)
  const panzoomCleanupRef = useRef<(() => void) | null>(null)
  const hasAppliedInitialStartRef = useRef(false)
  const previousOrientationRef = useRef<Orientation>('vertical')
  const debugLog = (...args: unknown[]) => console.log('[tree-debug]', ...args)

  useEffect(() => {
    const loadData = async () => {
      const response = await fetch('./family.json')
      const familyData: FamilyData = await response.json()
      setData(familyData)
    }
    void loadData()
  }, [])

  const indexes = useMemo(() => (data ? buildIndexes(data) : null), [data])
  const oldestRootId = useMemo(() => (data ? getOldestPersonId(data.people) : null), [data])
  const mainTreeIds = useMemo(() => {
    if (!indexes || !oldestRootId) return new Set<string>()
    return buildMainSet(oldestRootId, indexes)
  }, [indexes, oldestRootId])

  const visibleIds = useMemo(() => {
    if (!indexes || !oldestRootId) return new Set<string>()
    if (scopedPersonId) return buildScopedSet(scopedPersonId, indexes)
    return mainTreeIds
  }, [indexes, oldestRootId, scopedPersonId, mainTreeIds])

  const layoutRootId = useMemo(() => {
    if (!indexes || visibleIds.size === 0) return null
    const visiblePeople = [...visibleIds]
      .map((id) => indexes.personById.get(id))
      .filter((person): person is Person => Boolean(person))
    return getOldestPersonId(visiblePeople)
  }, [indexes, visibleIds])

  const layout = useMemo(() => {
    if (!indexes || !data || !layoutRootId) return null
    return computeLayout(visibleIds, layoutRootId, indexes, data.relationships, orientation)
  }, [data, indexes, layoutRootId, orientation, visibleIds])

  const fuse = useMemo(() => {
    if (!data || !indexes || mainTreeIds.size === 0) return null
    const searchablePeople = [...mainTreeIds]
      .map((id) => indexes.personById.get(id))
      .filter((person): person is Person => Boolean(person))

    return new Fuse(searchablePeople, {
      includeScore: true,
      threshold: 0.35,
      ignoreLocation: true,
      keys: ['firstName', 'lastName', 'maidenName'],
    })
  }, [data, indexes, mainTreeIds])

  const searchResults = useMemo(() => {
    if (!fuse || !searchQuery.trim()) return []
    return fuse.search(searchQuery.trim()).slice(0, MAX_SEARCH_RESULTS)
  }, [fuse, searchQuery])

  useEffect(() => {
    if (!layout || panzoomRef.current || !viewportRef.current || !canvasRef.current) return
    const panzoom = Panzoom(canvasRef.current, {
      maxScale: MAX_SCALE,
      minScale: MIN_SCALE,
      startScale: DEFAULT_SCALE,
      canvas: true,
      contain: 'outside',
    })
    panzoomRef.current = panzoom
    setPanzoomReady(true)
    debugLog('panzoom initialized', {
      viewportWidth: viewportRef.current.clientWidth,
      viewportHeight: viewportRef.current.clientHeight,
      startScale: DEFAULT_SCALE,
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
      transform: getComputedStyle(canvasRef.current).transform,
    })

    const viewport = viewportRef.current
    const wheelListener = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      event.stopPropagation()
      const target = event.target
      if (!(target instanceof Node) || !viewport.contains(target)) return
      panzoom.zoomWithWheel(event)
    }
    const keydownListener = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '0') {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('wheel', wheelListener, { passive: false, capture: true })
    document.addEventListener('wheel', wheelListener, { passive: false, capture: true })
    window.addEventListener('keydown', keydownListener, { capture: true })
    document.addEventListener('keydown', keydownListener, { capture: true })

    panzoomCleanupRef.current = () => {
      window.removeEventListener('wheel', wheelListener, { capture: true })
      document.removeEventListener('wheel', wheelListener, { capture: true })
      window.removeEventListener('keydown', keydownListener, { capture: true })
      document.removeEventListener('keydown', keydownListener, { capture: true })
      panzoom.destroy()
      panzoomRef.current = null
      setPanzoomReady(false)
      debugLog('panzoom destroyed')
    }
  }, [layout])

  useEffect(() => {
    return () => {
      panzoomCleanupRef.current?.()
      panzoomCleanupRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!layout || !canvasRef.current) return
    canvasRef.current.style.width = `${layout.width}px`
    canvasRef.current.style.height = `${layout.height}px`
    debugLog('layout applied', { width: layout.width, height: layout.height, nodes: layout.nodes.size })
  }, [layout])

  useEffect(() => {
    if (!layout || !centerRequest || !viewportRef.current || !panzoomReady) return
    const panzoom = panzoomRef.current
    const target = layout.nodes.get(centerRequest.id)
    debugLog('center effect trigger', {
      centerRequest,
      hasPanzoom: Boolean(panzoom),
      hasTarget: Boolean(target),
    })
    if (!panzoom || !target) return

    const viewport = viewportRef.current
    const centerAtScale = centerRequest.scale ?? panzoom.getScale()
    debugLog('center before transform', {
      currentScale: panzoom.getScale(),
      target,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      canvasTransform: canvasRef.current ? getComputedStyle(canvasRef.current).transform : null,
    })
    panzoom.zoom(centerAtScale, { force: true })
    const x = viewport.clientWidth / 2 - (target.x + target.width / 2) * centerAtScale
    const y = viewport.clientHeight / 2 - (target.y + target.height / 2) * centerAtScale
    panzoom.pan(x, y, { force: true })
    requestAnimationFrame(() => {
      debugLog('center after transform', {
        scale: panzoom.getScale(),
        x,
        y,
        canvasTransform: canvasRef.current ? getComputedStyle(canvasRef.current).transform : null,
      })
    })
    setCenterRequest(null)
  }, [centerRequest, layout, panzoomReady])

  useEffect(() => {
    if (!layout || !viewportRef.current || fitRequestNonce === 0 || !panzoomReady) return
    const panzoom = panzoomRef.current
    debugLog('fit effect trigger', { fitRequestNonce, hasPanzoom: Boolean(panzoom) })
    if (!panzoom) return

    const viewport = viewportRef.current
    const availableWidth = Math.max(1, viewport.clientWidth - FIT_PADDING)
    const availableHeight = Math.max(1, viewport.clientHeight - FIT_PADDING)
    const fitScale = Math.min(
      availableWidth / layout.width,
      availableHeight / layout.height,
    )
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, fitScale * FIT_SAFETY))
    debugLog('fit before transform', {
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      availableWidth,
      availableHeight,
      fitScale,
      nextScale,
      currentScale: panzoom.getScale(),
      canvasTransform: canvasRef.current ? getComputedStyle(canvasRef.current).transform : null,
    })
    panzoom.zoom(nextScale, { force: true })
    const x = (viewport.clientWidth - layout.width * nextScale) / 2
    const y = (viewport.clientHeight - layout.height * nextScale) / 2
    panzoom.pan(x, y, { force: true })
    requestAnimationFrame(() => {
      debugLog('fit after transform', {
        scale: panzoom.getScale(),
        x,
        y,
        canvasTransform: canvasRef.current ? getComputedStyle(canvasRef.current).transform : null,
      })
    })
  }, [fitRequestNonce, layout, panzoomReady])

  useEffect(() => {
    if (!layout || !oldestRootId || !panzoomReady) return
    const orientationChanged = previousOrientationRef.current !== orientation
    if (!hasAppliedInitialStartRef.current || orientationChanged) {
      setScopedPersonId(null)
      setCenterRequest({ id: oldestRootId, scale: DEFAULT_SCALE, nonce: Date.now() })
      hasAppliedInitialStartRef.current = true
    }
    previousOrientationRef.current = orientation
  }, [layout, oldestRootId, orientation, panzoomReady])

  if (!data || !indexes || !layout) {
    return (
      <main className="flex h-screen items-center justify-center bg-zinc-100 text-zinc-600">
        Loading family tree...
      </main>
    )
  }

  const selectNode = (personId: string) => {
    setSelectedPersonId(personId)
    setScopedPersonId(personId)
    setHighlightedPersonId(personId)
    setCenterRequest({ id: personId, nonce: Date.now() })
  }

  const selectFromSearch = (personId: string) => {
    setSelectedPersonId(personId)
    setHighlightedPersonId(personId)
    if (scopedPersonId && !visibleIds.has(personId)) {
      setScopedPersonId(null)
    }
    setCenterRequest({ id: personId, nonce: Date.now() })
  }

  return (
    <main className="h-screen bg-zinc-100 text-zinc-900">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-zinc-300 bg-zinc-100/95 px-4 backdrop-blur-sm">
        <div className="relative w-full max-w-md">
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by first name, last name, or maiden name..."
            className="w-full rounded-none border border-zinc-400 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2"
          />
          {searchResults.length > 0 ? (
            <ul className="absolute left-0 right-0 top-[110%] max-h-72 overflow-auto border border-zinc-400 bg-white text-sm shadow-lg">
              {searchResults.map(({ item }) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-100"
                    onClick={() => selectFromSearch(item.id)}
                  >
                    <span>{fullName(item)}</span>
                    <span className="text-xs text-zinc-500">{formatLifeRange(item)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              debugLog('start button click', { oldestRootId })
              setScopedPersonId(null)
              if (oldestRootId) {
                setCenterRequest({ id: oldestRootId, scale: DEFAULT_SCALE, nonce: Date.now() })
              }
            }}
            className="border border-zinc-400 bg-white px-3 py-2 text-xs text-zinc-700"
          >
            Start
          </button>
          <button
            type="button"
            onClick={() => {
              debugLog('fit button click')
              setFitRequestNonce((current) => current + 1)
            }}
            className="border border-zinc-400 bg-white px-3 py-2 text-xs text-zinc-700"
          >
            Fit Screen
          </button>
          <button
            type="button"
            onClick={() => setOrientation('vertical')}
            className={`border px-3 py-2 text-xs ${
              orientation === 'vertical'
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-zinc-400 bg-white text-zinc-700'
            }`}
          >
            Top-Down
          </button>
          <button
            type="button"
            onClick={() => setOrientation('horizontal')}
            className={`border px-3 py-2 text-xs ${
              orientation === 'horizontal'
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-zinc-400 bg-white text-zinc-700'
            }`}
          >
            Left-Right
          </button>
          {scopedPersonId ? (
            <button
              type="button"
              onClick={() => {
                setScopedPersonId(null)
                if (oldestRootId) {
                  setCenterRequest({ id: oldestRootId, nonce: Date.now() })
                }
              }}
              className="border border-zinc-400 bg-white px-3 py-2 text-xs text-zinc-700"
            >
              Return to Main Tree
            </button>
          ) : null}
        </div>
      </header>

      <section ref={viewportRef} className="relative h-[calc(100vh-4rem)] w-full overflow-auto bg-zinc-100">
        <div ref={canvasRef} className="absolute left-0 top-0 origin-top-left">
          <svg className="tree-lines absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true">
            {layout.edges.map((edge) => (
              <path
                key={edge.key}
                d={edge.d}
                fill="none"
                stroke={edge.type === 'marriage' ? '#6366f1' : '#52525b'}
                strokeWidth={1.5}
              />
            ))}
          </svg>

          {[...layout.nodes.values()].map((node) => {
            const person = indexes.personById.get(node.id)
            if (!person) return null
            const isHighlighted = highlightedPersonId === node.id
            const spouses = getOrderedSpouseIds(node.id, indexes)
              .map((spouseId) => indexes.personById.get(spouseId))
              .filter((spouse): spouse is Person => Boolean(spouse))

            return (
              <button
                key={node.id}
                type="button"
                onClick={() => selectNode(node.id)}
                className={`absolute flex w-[220px] flex-col items-start justify-start border bg-white px-3 py-2 text-left shadow-sm transition ${
                  isHighlighted
                    ? 'border-indigo-600 ring-2 ring-indigo-300'
                    : selectedPersonId === node.id
                      ? 'border-zinc-700'
                      : 'border-zinc-400 hover:border-zinc-600'
                }`}
                style={{ left: `${node.x}px`, top: `${node.y}px`, height: `${node.height}px` }}
              >
                <div className="line-clamp-1 w-full text-sm font-medium text-zinc-900">{fullName(person)}</div>
                <div className="mt-1 text-xs text-zinc-600">{formatLifeRange(person)}</div>
                {spouses.map((spouse) => (
                  <div key={`${node.id}-${spouse.id}`} className="mt-2 w-full">
                    <div className="line-clamp-1 w-full text-xs font-medium text-zinc-800">{fullName(spouse)}</div>
                    <div className="text-[11px] text-zinc-600">{formatLifeRange(spouse)}</div>
                  </div>
                ))}
              </button>
            )
          })}
        </div>
      </section>
    </main>
  )
}

export default App
