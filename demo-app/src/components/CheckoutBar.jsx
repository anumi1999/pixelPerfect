import './CheckoutBar.css';

export default function CheckoutBar({ total }) {
  return (
    <footer className="checkout-bar">
      <span className="checkout-bar__total">Total <strong>${total}</strong></span>
      <button className="checkout-bar__button" type="button">Checkout</button>
    </footer>
  );
}
