import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PieChart, Pie, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'

type Transaction = { id: string; date: string; merchant: string; amount: number; category?: string | null; statementId: string }
type CategoryRule = { merchant: string; category: string }
type Statement = { id: string; label: string; start: string; end: string }

const CATEGORY_LIST = ['utilities','auto','meal','travel','insurance','office','purchases','shipping'] as const
const CATEGORY_LABELS: Record<string,string> = {
  utilities:'Utilities', auto:'Auto', meal:'Meal', travel:'Travel', insurance:'Insurance', office:'Office', purchases:'Purchases', shipping:'Shipping'
}

const LS_KEYS = { transactions:'sec_transactions_v1', statements:'sec_statements_v1', rules:'sec_rules_v1', ui:'sec_ui_v1' }
const loadLS = <T,>(k:string, fb:T):T => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb } catch { return fb } }
const saveLS = <T,>(k:string, v:T) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
const uid = (p='id') => `${p}_${Math.random().toString(36).slice(2,9)}`

function parseCSV(text:string, statementId:string):Transaction[] {
  const lines = text.replace(/\r/g,'').split(/\n+/).filter(Boolean)
  if (!lines.length) return []
  const header = lines[0].split(/,|;|\t/).map(h=>h.trim().toLowerCase())
  const idxDate = header.findIndex(h=>/date/.test(h))
  const idxDesc = header.findIndex(h=>/(description|merchant|payee|name)/.test(h))
  const idxAmt  = header.findIndex(h=>/(amount|amt|usd)/.test(h))
  const out:Transaction[] = []
  for (let i=1;i<lines.length;i++) {
    const cols = lines[i].split(/,|;|\t/)
    const date = (cols[idxDate]||'').trim()
    const merchant = (cols[idxDesc]||'').trim()
    let amount = parseFloat((cols[idxAmt]||'0').replace(/[^0-9.-]/g,''))
    if (!isFinite(amount) || isNaN(amount)) amount = 0
    if (!date || !merchant) continue
    out.push({ id: uid('t'), date, merchant, amount, category: null, statementId })
  }
  return out
}

async function parsePDF(file: File, statementId: string): Promise<Transaction[]> {
  // pdfjs-dist v4
  const pdfjs = await import('pdfjs-dist')
  // @ts-ignore
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs')
  // @ts-ignore
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  // @ts-ignore
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const texts: string[] = []
  for (let p=1; p<=pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    texts.push((tc.items as any[]).map(it => it.str).join(' '))
  }
  const text = texts.join('\n')
  const re = /(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}).{1,80}?(?:\$?(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)|(-?\d+\.\d{2}))/g
  const out: Transaction[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const date = m[1]
    const rawAmt = m[2] || m[3] || '0'
    const amount = parseFloat(rawAmt.replace(/[,$]/g,''))
    const ctx = text.slice(Math.max(0, m.index-60), m.index+60)
    const merchant = (ctx.replace(date,'').replace(rawAmt,'').trim() || 'Unknown').slice(0,60)
    out.push({ id: uid('t'), date, merchant, amount, category: null, statementId })
  }
  return out
}

function monthLabelFromDates(dates:string[]) {
  const parsed = dates.map(d=>new Date(d)).filter(d=>!isNaN(+d))
  if (!parsed.length) return { label:'Unknown Statement', start:new Date().toISOString(), end:new Date().toISOString() }
  parsed.sort((a,b)=>+a-+b)
  const start = parsed[0], end = parsed[parsed.length-1]
  const fmt = (d:Date)=> d.toLocaleDateString(undefined,{year:'numeric', month:'short', day:'2-digit'})
  const month = start.toLocaleDateString(undefined,{year:'numeric', month:'long'})
  return { label: `${month} (${fmt(start)} – ${fmt(end)})`, start:start.toISOString(), end:end.toISOString() }
}

function groupTotals(transactions:Transaction[]) {
  const map:Record<string,number> = {}
  for (const t of transactions) {
    const cat = t.category || 'uncategorized'
    map[cat] = (map[cat]||0) + t.amount
  }
  return map
}

function applyRules(ts:Transaction[], rules:CategoryRule[]) {
  const ruleMap = new Map(rules.map(r => [r.merchant.toLowerCase(), r.category]))
  return ts.map(t => {
    const key = t.merchant.toLowerCase()
    const exact = ruleMap.get(key)
    if (exact) return { ...t, category: t.category ?? exact }
    for (const [m, c] of ruleMap) {
      if (key.includes(m)) return { ...t, category: t.category ?? c }
    }
    return t
  })
}

function toDateKey(s:string) {
  const d = new Date(s)
  if (!isNaN(+d)) return d.toISOString().slice(0,10)
  const m = s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/)
  if (m) {
    const mm = m[1].padStart(2,'0')
    const dd = m[2].padStart(2,'0')
    const yyyy = m[3].length===2 ? `20${m[3]}` : m[3]
    return `${yyyy}-${mm}-${dd}`
  }
  return s
}

function groupByDate(transactions:Transaction[]) {
  const map:Record<string,Record<string,number>> = {}
  for (const t of transactions) {
    const date = toDateKey(t.date)
    const cat = t.category || 'uncategorized'
    map[date] ||= {}
    map[date][cat] = (map[date][cat]||0) + t.amount
  }
  const rows = Object.entries(map).map(([date, cats]) => ({
    date,
    ...CATEGORY_LIST.reduce((acc, c) => ({ ...acc, [c]: cats[c] || 0 }), {} as Record<string,number>)
  }))
  rows.sort((a,b)=> new Date(a.date).getTime() - new Date(b.date).getTime())
  return rows
}

export default function App() {
  const [transactions, setTransactions] = useState<Transaction[]>(() => loadLS(LS_KEYS.transactions, []))
  const [statements, setStatements] = useState<Statement[]>(() => loadLS(LS_KEYS.statements, []))
  const [rules, setRules] = useState<CategoryRule[]>(() => loadLS(LS_KEYS.rules, []))
  const [activeTab, setActiveTab] = useState<string>(() => loadLS(LS_KEYS.ui, { tab:'categorize' }).tab || 'categorize')
  const [selectedStatementId, setSelectedStatementId] = useState<string>(() => loadLS(LS_KEYS.ui, { statementId:'' }).statementId || '')
  const [history, setHistory] = useState<Transaction[][]>([])

  useEffect(()=>saveLS(LS_KEYS.transactions, transactions),[transactions])
  useEffect(()=>saveLS(LS_KEYS.statements, statements),[statements])
  useEffect(()=>saveLS(LS_KEYS.rules, rules),[rules])
  useEffect(()=>saveLS(LS_KEYS.ui, { tab:activeTab, statementId:selectedStatementId }),[activeTab, selectedStatementId])
  useEffect(()=>{ setTransactions(prev => applyRules(prev, rules)) }, [rules.length])

  const byStatement = useMemo(() => {
    const m:Record<string,Transaction[]> = {}
    for (const t of transactions) (m[t.statementId] ||= []).push(t)
    return m
  }, [transactions])

  const statementOptions = useMemo(()=> statements.map(s=>({id:s.id, label:s.label})),[statements])
  useEffect(()=>{ if (!selectedStatementId && statements.length) setSelectedStatementId(statements[0].id) },[statements.length])

  const activeTx = byStatement[selectedStatementId] || []
  const uncategorized = activeTx.filter(t=>!t.category)
  const totals = groupTotals(activeTx)
  const categorizedCount = activeTx.length - uncategorized.length

  function pushHistory(){ setHistory(h => [...h, transactions]) }
  function undo(){ const prev = history[history.length-1]; if (!prev) return; setHistory(h=>h.slice(0,-1)); setTransactions(prev) }

  function assignCategory(txId:string, category:string, learn=true) {
    pushHistory()
    setTransactions(prev => prev.map(t => t.id===txId ? { ...t, category } : t))
    if (learn) {
      const tx = transactions.find(t => t.id===txId)
      if (tx) {
        const exists = rules.find(r => r.merchant.toLowerCase() === tx.merchant.toLowerCase())
        const next = exists ? rules.map(r => r.merchant.toLowerCase()===tx.merchant.toLowerCase() ? { ...r, category } : r) : [...rules, { merchant: tx.merchant, category }]
        setRules(next)
      }
    }
  }

  async function onFilesChosen(files: FileList | null) {
    if (!files || !files.length) return
    const allNew: Transaction[] = []
    for (const file of Array.from(files)) {
      const statementId = uid('stmt')
      let parsed: Transaction[] = []
      if (/\.csv$/i.test(file.name)) {
        const text = await file.text()
        parsed = parseCSV(text, statementId)
      } else if (/\.pdf$/i.test(file.name)) {
        try { parsed = await parsePDF(file, statementId) } catch (e) { console.error(e); alert('PDF parsing failed. Please upload a CSV with Date, Description, Amount headers.'); continue }
      } else {
        alert('Unsupported file type. Please upload a CSV or PDF.')
        continue
      }
      if (!parsed.length) continue
      const md = monthLabelFromDates(parsed.map(p=>p.date))
      const statement: Statement = { id: statementId, label: md.label, start: md.start, end: md.end }
      const withRules = applyRules(parsed, rules)
      allNew.push(...withRules)
      setStatements(prev => [{ ...statement }, ...prev ])
      setSelectedStatementId(cur => cur || statementId)
    }
    if (allNew.length) setTransactions(prev => [...allNew, ...prev])
  }

  function exportCSV(stmtId:string) {
    const header = ['Date','Merchant','Amount','Category'].join(',')
    const rows = (byStatement[stmtId]||[]).map(t => [t.date, csvEscape(t.merchant), t.amount.toFixed(2), t.category || ''].join(','))
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `categorized_${stmtId}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  const csvEscape = (s:string) => /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s

  // Drag and drop handlers
  function handleDragStart(e: React.DragEvent, txId: string) { e.dataTransfer.setData('text/plain', txId) }
  function allowDrop(e: React.DragEvent){ e.preventDefault() }
  function handleDrop(e: React.DragEvent, cat: string){ const txId = e.dataTransfer.getData('text/plain'); if (txId) assignCategory(txId, cat, true) }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Smart Expense Categorizer</h1>
            <p className="text-slate-300 text-sm mt-1">Upload statements • categorize with multiple choice or drag-and-drop • learns your preferences • analytics per statement</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>setActiveTab('categorize')} className={`px-3 py-2 rounded-lg border ${activeTab==='categorize'?'bg-slate-800 border-slate-600':'border-slate-700'}`}>Categorize</button>
            <button onClick={()=>setActiveTab('analytics')} className={`px-3 py-2 rounded-lg border ${activeTab==='analytics'?'bg-slate-800 border-slate-600':'border-slate-700'}`}>Analytics</button>
            <button onClick={()=>setActiveTab('manage')} className={`px-3 py-2 rounded-lg border ${activeTab==='manage'?'bg-slate-800 border-slate-600':'border-slate-700'}`}>Manage Rules</button>
          </div>
        </header>

        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-4">
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
            <label className="inline-flex items-center gap-3 cursor-pointer">
              <input type="file" multiple accept=".csv,.pdf" className="hidden" onChange={(e)=>onFilesChosen(e.target.files)} />
              <span className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 transition">Upload CSV or PDF</span>
            </label>

            <select className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700" value={selectedStatementId} onChange={(e)=>setSelectedStatementId(e.target.value)}>
              <option value="" disabled>Select a statement</option>
              {statementOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>

            {selectedStatementId && (
              <div className="ml-auto flex gap-2">
                <button className="px-3 py-2 rounded-lg border border-slate-700" onClick={()=>exportCSV(selectedStatementId)}>Export CSV</button>
                <button className="px-3 py-2 rounded-lg border border-red-700 text-red-300" onClick={()=>{
                  const ok = confirm('Remove this statement and its transactions?')
                  if (!ok) return
                  const stmtId = selectedStatementId
                  // remove
                  const remainingStmts = statements.filter(s => s.id !== stmtId)
                  const remainingTx = transactions.filter(t => t.statementId !== stmtId)
                  setStatements(remainingStmts)
                  setTransactions(remainingTx)
                  setSelectedStatementId(remainingStmts[0]?.id ?? '')
                }}>Remove Statement</button>
              </div>
            )}
          </div>
        </div>

        {activeTab === 'categorize' && (
          <div className="grid md:grid-cols-12 gap-6">
            <div className="md:col-span-8 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="flex items-center justify-between p-4 border-b border-slate-800">
                <span className="font-semibold">Transactions ({categorizedCount}/{activeTx.length} categorized)</span>
                <button className="px-3 py-1.5 rounded-lg border border-slate-700" onClick={undo} disabled={!history.length}>Back</button>
              </div>
              <div className="p-4 space-y-2">
                {!activeTx.length && <p className="text-slate-400">Upload a statement to begin.</p>}
                <AnimatePresence>
                  {activeTx.map(t => (
                    <motion.div key={t.id} layout initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}}
                      draggable onDragStart={(e)=>handleDragStart(e,t.id)}
                      className="flex items-center justify-between bg-slate-950/60 rounded-xl border border-slate-800 p-3">
                      <div className="flex flex-col">
                        <span className="font-medium">{t.merchant || '(No Description)'}</span>
                        <div className="text-xs text-slate-400">{new Date(t.date).toLocaleDateString()} • ${t.amount.toFixed(2)}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className={`text-xs px-2 py-1 rounded-full border ${t.category ? 'border-slate-600 text-slate-200':'border-slate-700 text-slate-400'}`}>
                          {t.category ? (CATEGORY_LABELS[t.category] || t.category) : 'uncategorized'}
                        </span>
                        <div className="hidden md:flex gap-1 flex-wrap">
                          {CATEGORY_LIST.map(c => (
                            <button key={c} onClick={()=>assignCategory(t.id, c, true)} className="text-xs px-2 py-1 rounded-lg border border-slate-700 capitalize hover:bg-slate-800">
                              {CATEGORY_LABELS[c]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>

            <div className="md:col-span-4 space-y-4">
              {CATEGORY_LIST.map(c => (
                <div key={c} onDrop={(e)=>handleDrop(e,c)} onDragOver={allowDrop}
                  className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold capitalize">{CATEGORY_LABELS[c]}</h3>
                  </div>
                  <p className="text-xs text-slate-400">Drag a transaction here or use the buttons in the list.</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="grid md:grid-cols-12 gap-6">
            <div className="md:col-span-7 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="p-4 border-b border-slate-800 font-semibold">Category Breakdown</div>
              <div className="p-4">
                {activeTx.length ? (
                  <div style={{ width:'100%', height: 320 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie dataKey="value" data={Object.entries(totals).map(([k,v]) => ({ name: CATEGORY_LABELS[k] || k, value: Math.abs(v as number) }))} outerRadius={120} label />
                        <Tooltip formatter={(v:number)=>`$${v.toFixed(2)}`} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : <p className="text-slate-400">No data yet.</p>}
              </div>
            </div>

            <div className="md:col-span-5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="p-4 border-b border-slate-800 font-semibold">Totals</div>
              <div className="p-4 space-y-2">
                {[...CATEGORY_LIST, 'uncategorized'].map(c => (
                  <div key={c} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-slate-300">{CATEGORY_LABELS[c] || c}</span>
                    <span className="font-semibold">${(totals[c]||0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="md:col-span-12 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="p-4 border-b border-slate-800 font-semibold">Spending Over Time (Selected Statement)</div>
              <div className="p-4" style={{ width:'100%', height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={groupByDate(activeTx)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip formatter={(v:number)=>`$${v.toFixed(2)}`} />
                    <Legend />
                    {CATEGORY_LIST.map(c => (<Bar key={c} dataKey={c} stackId="a" />))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'manage' && (
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800">
            <div className="p-4 border-b border-slate-800 font-semibold">Merchant Rules (auto-learning)</div>
            <div className="p-4">
              {rules.length===0 && <p className="text-slate-400 mb-3">No saved rules yet. As you categorize, we’ll remember your choices here.</p>}
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {rules.map((r, idx) => (
                  <div key={`${r.merchant}_${idx}`} className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/50">
                    <div>
                      <div className="font-medium">{r.merchant}</div>
                      <div className="text-xs text-slate-400 capitalize">{CATEGORY_LABELS[r.category] || r.category}</div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <select className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 capitalize"
                        onChange={(e)=>{
                          const v = e.target.value
                          setRules(prev => prev.map((x,i)=> i===idx ? { ...x, category: v } : x))
                        }} defaultValue={r.category}>
                        {CATEGORY_LIST.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                      </select>
                      <button className="px-2 py-1 rounded-lg border border-red-700 text-red-300" onClick={()=>setRules(prev => prev.filter((_,i)=>i!==idx))}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
