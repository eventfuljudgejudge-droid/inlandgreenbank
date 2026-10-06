export default function Loading() {
  return (
    <>
      <header className="sk-header">
        <div className="sk-seal" />
        <div className="sk-spacer" />
        <div className="sk-pills">
          {[80, 70, 65, 75, 60].map((w, i) => (
            <div key={i} className="sk-pill" style={{ width: w }} />
          ))}
        </div>
      </header>
      <main className="sk-main">
        <div className="sk-title" />
        <div className="sk-sub" />
        <div className="sk-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="sk-card" />
          ))}
        </div>
        <div className="sk-table" />
      </main>
      <style>{`
        .sk-header{height:62px;background:var(--slate-900);display:flex;align-items:center;padding:0 24px;gap:20px}
        .sk-seal{width:120px;height:20px;border-radius:6px;background:rgba(255,255,255,0.06)}
        .sk-spacer{flex:1}
        .sk-pills{display:flex;gap:10px}
        .sk-pill{height:14px;border-radius:4px;background:rgba(255,255,255,0.04)}
        .sk-main{max-width:1100px;margin:0 auto;padding:40px 28px}
        .sk-title{width:200px;height:28px;border-radius:6px;background:var(--border-subtle);margin-bottom:8px}
        .sk-sub{width:320px;height:16px;border-radius:4px;background:var(--border-subtle);margin-bottom:36px}
        .sk-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:36px}
        .sk-card{height:100px;border-radius:var(--radius-lg);background:var(--white);border:1px solid var(--border-subtle);box-shadow:var(--shadow-sm);animation:skeleton-pulse 1.8s ease-in-out infinite}
        .sk-table{height:300px;border-radius:var(--radius-lg);background:var(--white);border:1px solid var(--border-subtle);box-shadow:var(--shadow-sm);animation:skeleton-pulse 1.8s ease-in-out infinite}
        @keyframes skeleton-pulse{0%,100%{opacity:1}50%{opacity:.5}}
        @media (max-width:640px){
          .sk-header{padding:0 16px;height:56px}
          .sk-pills{display:none}
          .sk-main{padding:28px 16px}
          .sk-title{width:160px!important}
          .sk-sub{width:220px!important}
          .sk-grid{grid-template-columns:1fr;gap:14px;margin-bottom:24px}
          .sk-table{height:240px}
        }
        @media (max-width:380px){
          .sk-seal{width:100px}
          .sk-title{width:140px!important}
          .sk-sub{width:180px!important}
        }
      `}</style>
    </>
  );
}