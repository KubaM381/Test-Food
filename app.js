(() => {
  'use strict';

  /* ========================================================================
     Konfiguration & Supabase-Anbindung
     ======================================================================== */
  const SUPABASE_URL = 'https://keaahccmqnmvtcmabvvz.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlYWFoY2NtcW5tdnRjbWFidnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjQwMjYsImV4cCI6MjA5ODI0MDAyNn0.njXGfpgYqplV5KqFB2QAwpFv8cl_EDsH5CTQBMEciPM';
  const CART_KEY = 'warenkorbItems';

  /* ========================================================================
     Zustand & Cache
     ======================================================================== */
  const state = {
    product: null,
    quantity: 1
  };

  const els = {};

  const CHECK_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10.5L8 14.5L16 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ========================================================================
     Hilfsfunktionen
     ======================================================================== */
  function formatPrice(value) {
    const num = parseFloat(value) || 0;
    return num.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  }

  function getProductIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  /* ========================================================================
     Datenbank-Abruf (Supabase)
     ======================================================================== */
  async function fetchProductById(id) {
    if (!id || !window.supabase) {
      console.error('Keine ID vorhanden oder Supabase SDK nicht geladen.');
      return null;
    }

    try {
      const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Fehler beim Laden des Produkts aus Supabase:', err);
      return null;
    }
  }

  /* ========================================================================
     DOM-Referenzen
     ======================================================================== */
  function cacheElements() {
    els.productView = document.getElementById('productView');
    els.notFoundView = document.getElementById('notFoundView');
    els.actionBar = document.getElementById('actionBar');

    els.image = document.getElementById('productImage');
    els.name = document.getElementById('productName');
    els.ratingValue = document.getElementById('ratingValue');
    els.reviewCount = document.getElementById('reviewCount');
    els.price = document.getElementById('productPrice');
    els.description = document.getElementById('productDescription');
    els.featuresList = document.getElementById('featuresList');

    els.backBtn = document.getElementById('backBtn');
    els.cartBtn = document.getElementById('cartBtn');
    els.cartBadge = document.getElementById('cartBadge');

    els.qtyMinus = document.getElementById('qtyMinus');
    els.qtyPlus = document.getElementById('qtyPlus');
    els.qtyValue = document.getElementById('qtyValue');
    els.chips = Array.from(document.querySelectorAll('.chip'));

    els.buyBtn = document.getElementById('buyBtn');
    els.buyBtnLabel = document.getElementById('buyBtnLabel');
  }

  /* ========================================================================
     Warenkorb-Logik
     ======================================================================== */
  function getCart() {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  }

  function updateCartBadge() {
    const cart = getCart();
    const totalItems = cart.reduce((sum, item) => sum + (item.qty || 1), 0);
    if (els.cartBadge) {
      els.cartBadge.textContent = String(totalItems);
      els.cartBadge.hidden = totalItems <= 0;
    }
  }

  function addToCart(product, quantity) {
    let cart = getCart();
    const existingIndex = cart.findIndex((item) => String(item.id) === String(product.id));

    if (existingIndex > -1) {
      cart[existingIndex].qty = (cart[existingIndex].qty || 1) + quantity;
    } else {
      cart.push({
        id: product.id,
        name: product.name || 'Produkt',
        price: parseFloat(product.price) || 0,
        image: product.image || '',
        qty: quantity
      });
    }

    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
  }

  /* ========================================================================
     Rendering
     ======================================================================== */
  function renderFeatures(features) {
    els.featuresList.innerHTML = '';

    if (!features || !Array.isArray(features) || features.length === 0) {
      return;
    }

    features.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'feature-item';

      if (typeof item === 'object' && item !== null) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'feature-icon';
        iconSpan.textContent = item.icon || '✓';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'feature-content';

        const titleEl = document.createElement('strong');
        titleEl.className = 'feature-title';
        titleEl.textContent = item.title || '';

        const subEl = document.createElement('span');
        subEl.className = 'feature-subtitle';
        subEl.textContent = item.subtitle || '';

        contentDiv.appendChild(titleEl);
        if (item.subtitle) {
          contentDiv.appendChild(document.createElement('br'));
          contentDiv.appendChild(subEl);
        }

        li.appendChild(iconSpan);
        li.appendChild(contentDiv);
      } else {
        const icon = document.createElement('span');
        icon.innerHTML = CHECK_ICON;

        const text = document.createElement('span');
        text.textContent = String(item);

        li.appendChild(icon);
        li.appendChild(text);
      }

      els.featuresList.appendChild(li);
    });
  }

  function updateBuyButtonLabel() {
    if (!els.buyBtn || els.buyBtn.disabled || !state.product) return;
    const total = (parseFloat(state.product.price) || 0) * state.quantity;
    els.buyBtnLabel.textContent = `In den Warenkorb – ${formatPrice(total)}`;
  }

  function setQuantity(nextValue) {
    const clamped = Math.min(99, Math.max(1, nextValue));
    state.quantity = clamped;

    if (els.qtyValue) els.qtyValue.textContent = String(clamped);
    if (els.qtyMinus) els.qtyMinus.disabled = clamped <= 1;
    if (els.qtyPlus) els.qtyPlus.disabled = clamped >= 99;

    els.chips.forEach((chip) => {
      const isActive = Number(chip.dataset.qty) === clamped;
      chip.classList.toggle('is-active', isActive);
      chip.setAttribute('aria-pressed', String(isActive));
    });

    updateBuyButtonLabel();
  }

  function renderProduct(product) {
    state.product = product;

    if (els.productView) els.productView.hidden = false;
    if (els.actionBar) els.actionBar.hidden = false;
    if (els.notFoundView) els.notFoundView.hidden = true;

    if (product.image) {
      els.image.src = product.image;
    } else {
      els.image.src = `https://picsum.photos/seed/${product.id}/1200/1400`;
    }
    els.image.alt = product.name || 'Produktbild';

    els.name.textContent = product.name || 'Unbenanntes Produkt';

    const rating = parseFloat(product.rating) || 5.0;
    const reviews = parseInt(product.reviewCount) || 0;
    els.ratingValue.textContent = rating.toFixed(1);
    els.reviewCount.textContent = `(${reviews} Bewertungen)`;

    els.price.textContent = formatPrice(product.price);
    els.description.textContent = product.description || 'Keine Beschreibung verfügbar.';

    renderFeatures(product.features);
    setQuantity(1);
    updateCartBadge();

    document.title = `${product.name} – Produktdetails`;
  }

  function showNotFound() {
    if (els.productView) els.productView.hidden = true;
    if (els.actionBar) els.actionBar.hidden = true;
    if (els.notFoundView) els.notFoundView.hidden = false;
    document.title = 'Produkt nicht gefunden';
  }

  /* ========================================================================
     Interaktionen & Events
     ======================================================================== */
  function handleBuyClick() {
    addToCart(state.product, state.quantity);

    els.buyBtn.classList.add('is-added');
    els.buyBtn.disabled = true;
    els.buyBtnLabel.textContent = 'Zum Warenkorb hinzugefügt ✓';

    window.setTimeout(() => {
      els.buyBtn.classList.remove('is-added');
      els.buyBtn.disabled = false;
      updateBuyButtonLabel();
    }, 1500);
  }

  function bindEvents() {
    if (els.qtyMinus) els.qtyMinus.addEventListener('click', () => setQuantity(state.quantity - 1));
    if (els.qtyPlus) els.qtyPlus.addEventListener('click', () => setQuantity(state.quantity + 1));

    els.chips.forEach((chip) => {
      chip.addEventListener('click', () => setQuantity(Number(chip.dataset.qty)));
    });

    if (els.buyBtn) els.buyBtn.addEventListener('click', handleBuyClick);

    if (els.backBtn) {
      els.backBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
      });
    }

    if (els.cartBtn) {
      els.cartBtn.addEventListener('click', () => {
        window.location.href = 'warenkorb.html';
      });
    }
  }

  /* ========================================================================
     Initialisierung
     ======================================================================== */
  async function init() {
    cacheElements();

    const productId = getProductIdFromUrl();
    if (!productId) {
      showNotFound();
      return;
    }

    const product = await fetchProductById(productId);

    if (!product) {
      showNotFound();
      return;
    }

    renderProduct(product);
    bindEvents();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
