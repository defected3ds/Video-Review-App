import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Film, LoaderCircle, MessageSquare, RefreshCw, Search } from 'lucide-react';
import { api, clock, statusClass } from './review-utils.js';

const filters = ['Needs review', 'Changes requested', 'Approved', 'All'];
const matches = (asset, filter) => filter === 'All' || (filter === 'Needs review' ? asset.status !== 'Approved' : asset.status === filter);
export default function ReviewQueue({ onOpen }) {
  const [assets, setAssets] = useState([]), [filter, setFilter] = useState('Needs review'), [search, setSearch] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { setAssets(await api('/api/reviews')); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const shown = assets.filter(asset => matches(asset, filter) && `${asset.name} ${asset.project_name}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="review-queue" aria-label="All project reviews"><div className="queue-toolbar"><div className="queue-filters" aria-label="Review filters">{filters.map(value => <button key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}<span>{assets.filter(a => matches(a, value)).length}</span></button>)}</div><div className="queue-tools"><label className="search"><Search size={15}/><input aria-label="Search all reviews" placeholder="Find a video or project" value={search} onChange={e => setSearch(e.target.value)}/></label><button className="icon-button" aria-label="Refresh reviews" disabled={loading} onClick={load}><RefreshCw size={16}/></button></div></div>
    {loading ? <div className="queue-empty"><LoaderCircle className="spin" size={22}/><p>Loading reviews…</p></div> : error ? <div className="queue-empty" role="alert"><p>{error}</p><button className="secondary" onClick={load}>Try again</button></div> : !shown.length ? <div className="queue-empty"><CheckCircle2 size={28}/><h2>{search ? 'No matching videos' : filter === 'Needs review' ? 'No videos awaiting review' : `No ${filter === 'All' ? '' : filter.toLowerCase() + ' '}videos yet`}</h2><p>{search ? 'Try another video or project name.' : 'Use the filters to see other review statuses.'}</p></div> : <div className="queue-list">{shown.map(asset => <button className="queue-row" key={asset.id} onClick={() => onOpen(asset)} aria-label={`Review ${asset.name} in ${asset.project_name}`}><div className="queue-thumbnail"><img src={`/api/assets/${asset.id}/poster`} alt=""/><span>{clock(asset.duration)}</span></div><div className="queue-video"><strong><Film size={14}/>{asset.name}</strong><span>{asset.project_name}</span></div><span className={`status-badge ${statusClass(asset.status)}`}>{asset.status}</span><span className="queue-comments"><MessageSquare size={14}/>{asset.comment_count} open</span><ArrowRight size={17}/></button>)}</div>}
  </section>;
}
