export default function LoadingMistakes() {
  return <main className="mistake-book-page" aria-busy="true" aria-label="正在读取错题本"><div className="page-loading-bar"/><div className="mistake-book-list"><div className="mistake-entry skeleton-block"/><div className="mistake-entry skeleton-block"/></div></main>;
}
