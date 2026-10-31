import './Pagination.css';

export default function Pagination({ from, to, total }) {
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination__label">Items per page</span>
      <select className="pagination__select" defaultValue="10" aria-label="Items per page">
        <option>10</option>
        <option>25</option>
      </select>
      <span className="pagination__range">{from}–{to} of {total}</span>
    </nav>
  );
}
