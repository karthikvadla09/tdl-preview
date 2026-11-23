import { ArrowUpRight } from 'lucide-react'

export function SwissHero({ onOpen }: { onOpen: () => void }) {
  return (<div className="hero-card"><div className="swiss-index">01<span>DAILY OPERATIONS</span></div><div className="hero-copy"><div className="hero-kicker">STRUCTURE / BALANCE / CLARITY</div><h2>Good work.<br/>By design.</h2><p>One team. Three queues. A clear assignment for everyone.</p><button className="btn btn-light" onClick={()=>onOpen()}>Open daily TDL <ArrowUpRight size={18}/></button></div><div className="swiss-mark" aria-hidden="true"><ArrowUpRight size={128} strokeWidth={1.4}/></div></div>)
}
