import './ProductCard.css';
import './Featured.css';

export default function ProductCard({ product }) {
  return (
    <article className={`product-card${product.featured ? ' featured' : ''}`}>
      <div className="product-card__image" style={{ background: product.color }} aria-hidden="true" />
      {product.featured && <span className="product-card__badge">Bestseller</span>}
      <h3 className="product-card__title">{product.name}</h3>
      <p className="product-card__price">${product.price}</p>
      <button className="product-card__button" type="button">Add to cart</button>
    </article>
  );
}
