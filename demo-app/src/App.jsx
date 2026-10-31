import ProductCard from './components/ProductCard.jsx';
import Pagination from './components/Pagination.jsx';
import CheckoutBar from './components/CheckoutBar.jsx';
import PromoToast from './components/PromoToast.jsx';

const PRODUCTS = [
  { id: 1, name: 'Trail Runner', price: 89, featured: true, color: '#c8d6c1' },
  { id: 2, name: 'City Walker', price: 74, color: '#d9cdbf' },
  { id: 3, name: 'Ultralight Carbon-Plated Marathon Racer Pro', price: 189, color: '#c4cbe0' }
];

export default function App() {
  return (
    <main className="page">
      <h1 className="page__title">Your picks</h1>
      <p className="page__subtitle">3 items saved for checkout</p>
      <section className="product-grid">
        {PRODUCTS.map((p) => <ProductCard key={p.id} product={p} />)}
      </section>
      <Pagination from={1} to={3} total={3} />
      <CheckoutBar total={352} />
      <PromoToast />
    </main>
  );
}
