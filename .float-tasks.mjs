// Float the 任务 button at the far right of the Plugins sub-tab bar.
// Each view renders the button in a fixed-position wrapper; the kernel hides
// non-active tab panels, so only the active view's button is visible. Its
// position is measured from the tablist's bounding rect. UTF-8-safe.
import { readFileSync, writeFileSync } from 'node:fs'

const f = 'E:/Person/Project/DSCoder/src-tauri/resources/dsh-market/src/client/MarketSection.tsx'
let s = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

// 1) add the ref/state/measure effect after bodyRef
const bodyAnchor = `  const bodyRef = useRef<HTMLDivElement | null>(null)`
const bodyNew = `  const bodyRef = useRef<HTMLDivElement | null>(null)
  /** Floating 任务 button anchored to the Plugins section's tab bar. */
  const taskBarRef = useRef<HTMLDivElement | null>(null)
  const [taskPos, setTaskPos] = useState<{ top: number; right: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = taskBarRef.current
      if (el === null) return
      const panel = el.closest('[role="tabpanel"]')
      const section = panel?.parentElement ?? null
      const tablist = section?.querySelector('[role="tablist"]') ?? null
      const r = tablist?.getBoundingClientRect() ?? null
      if (r !== null) setTaskPos({ top: r.top + (r.height - 28) / 2, right: window.innerWidth - r.right })
      else setTaskPos({ top: 12, right: 24 })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])`
{
  const n = s.split(bodyAnchor).length - 1
  if (n !== 1) { console.error('bodyRef anchor: got ' + n); process.exit(1) }
  s = s.split(bodyAnchor).join(bodyNew)
}

// 2) remove the in-flow top-right button from the body
const oldFlex = `        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 0 8px' }}>
          <OperationsPanel
            t={t}
            describe={describePlugin}
            records={records}
            open={operationsOpen}
            onOpenChange={setOperationsOpen}
            replacing={replacing}
            envReady={envReady}
            onClearSettled={clearSettled}
            onCancel={() => doCancel()}
            onDismiss={record => drop(record.id)}
            onRefresh={() => location.reload()}
            onResolveConflict={resolveConflict}
          />
        </div>
        {tab === 'backup'`
const newFlex = `        {tab === 'backup'`
{
  const n = s.split(oldFlex).length - 1
  if (n !== 1) { console.error('flex div anchor: got ' + n); process.exit(1) }
  s = s.split(oldFlex).join(newFlex)
}

// 3) add the floating wrapper before the confirming modal
const confirmAnchor = `      {confirming !== null && (`
const confirmNew = `      <div
        ref={taskBarRef}
        style={{ position: 'fixed', top: taskPos?.top ?? 12, right: taskPos?.right ?? 24, zIndex: 30 }}
      >
        <OperationsPanel
          t={t}
          describe={describePlugin}
          records={records}
          open={operationsOpen}
          onOpenChange={setOperationsOpen}
          replacing={replacing}
          envReady={envReady}
          onClearSettled={clearSettled}
          onCancel={() => doCancel()}
          onDismiss={record => drop(record.id)}
          onRefresh={() => location.reload()}
          onResolveConflict={resolveConflict}
        />
      </div>
      {confirming !== null && (`
{
  const n = s.split(confirmAnchor).length - 1
  if (n !== 1) { console.error('confirm anchor: got ' + n); process.exit(1) }
  s = s.split(confirmAnchor).join(confirmNew)
}

writeFileSync(f, s)
console.log('OK: floating 任务 button added')
