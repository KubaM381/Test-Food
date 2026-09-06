(() => {
  'use strict';

  /* ========================================================================
     Mock-Datenbank (Lokaler Datenbestand)
     ======================================================================== */
  const PRODUCTS = [
    {
      id: 1,
      name: 'Nordlicht One – Over-Ear Kopfhörer',
      price: 349.0,
      rating: 4.8,
      reviewCount: 312,
      description:
        'Kabellose Over-Ear-Kopfhörer mit adaptiver Geräuschunterdrückung und einem 40-mm-Titanschwingsystem für einen warmen, präzisen Klang. Das eloxierte Aluminiumgehäuse und die Ohrpolster aus pflanzlich gegerbtem Leder sorgen für ganztägigen Tragekomfort.',
      features: [
        'Adaptive Geräuschunterdrückung mit Transparenzmodus',
        'Bis zu 38 Stunden Akkulaufzeit, Schnellladung für 5 Stunden in 10 Minuten',
        'Bluetooth 5.3 mit verlustfreiem LDAC-Codec',
        'Faltbares Gehäuse aus eloxiertem Aluminium, nur 268 g'
      ],
      image: 'https://picsum.photos/seed/nordlicht-one/1200/1400'
    },
    {
      id: 2,
      name: 'Terra Mini – Bluetooth-Lautsprecher',
      price: 129.0,
      rating: 4.6,
      reviewCount: 187,
      description:
        'Ein kompakter Lautsprecher mit erstaunlich vollem Klangbild, umhüllt von robustem Segeltuch und einem stoßfesten Silikonrahmen. IP67-zertifiziert und mit zwei Passivmembranen für satten Bass, auch im Freien.',
      features: [
        'Wasser- und staubdicht nach IP67',
        '20 Stunden Akkulaufzeit bei mittlerer Lautstärke',
        'Kopplung von zwei Lautsprechern für echten Stereoklang',
        'Integriertes Freisprechmikrofon'
      ],
      image: 'https://picsum.photos/seed/terra-mini/1200/1400'
    },
    {
      id: 3,
      name: 'Pulse Pro – True-Wireless-Earbuds',
      price: 199.0,
      rating: 4.7,
      reviewCount: 421,
      description:
        'Federleichte In-Ear-Kopfhörer mit individuell angepasstem Sitz, aktiver Geräuschunterdrückung und einer Ladehülle mit kabellosem Aufladen. Für den Sport ebenso geeignet wie für den Büroalltag.',
      features: [
        'Aktive Geräuschunterdrückung mit drei Stufen',
        'Bis zu 7 Stunden pro Ladung, 28 Stunden mit Ladehülle',
        'IPX4-Spritzwasserschutz',
        'Kabelloses Laden (Qi-kompatibel)'
      ],
      image: 'https://picsum.photos/seed/pulse-pro/1200/1400'
    }
  ];

  /* ========================================================================
     Zustand
     ======================================================================== */
  const state = {
    product: null,
    quantity: 1,
    cartCount: parseInt(localStorage.getItem('cartCount') || '0', 10)
  };

  const els = {};

  const CHECK_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10.5L8 14.5L16 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ========================================================================
     Hilfsfunktionen
     ======================================================================== */
  function formatPrice(value) {
    return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  }

  function formatRating(value) {
    return value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function getProductIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('id');
    if (raw === null || raw.trim() === '') {
      return 1; // Fallback: Lädt Produkt 1 beim direkten Aufrufen ohne URL-Parameter
    }
    const id = Number(raw);
    return Number.isFinite(id) ? id : 1;
  }

  function findProductById(id) {
    return PRODUCTS.find((item) => item.id === id);
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
     Rendering
     ======================================================================== */
  function renderFeatures(features) {
    els.featuresList.innerHTML = '';
    features.forEach((feature) => {
      const li = document.createElement('li');

      const icon = document.createElement('span');
      icon.innerHTML = CHECK_ICON;

      const text = document.createElement('span');
      text.textContent = feature;

      li.appendChild(icon);
      li.appendChild(text);
      els.featuresList.appendChild(li);
    });
  }

  function updateBuyButtonLabel() {
    if (els.buyBtn.disabled) {
      return;
    }
    const total = state.product.price * state.quantity;
    els.buyBtnLabel.textContent = `In den Warenkorb – ${formatPrice(total)}`;
  }

  function setQuantity(nextValue) {
    const clamped = Math.min(99, Math.max(1, nextValue));
    state.quantity = clamped;

    els.qtyValue.textContent = String(clamped);
    els.qtyMinus.disabled = clamped <= 1;
    els.qtyPlus.disabled = clamped >= 99;

    els.chips.forEach((chip) => {
      const isActive = Number(chip.dataset.qty) === clamped;
      chip.classList.toggle('is-active', isActive);
      chip.setAttribute('aria-pressed', String(isActive));
    });

    updateBuyButtonLabel();
  }

  function updateCartBadge(delta) {
    state.cartCount += delta;
    localStorage.setItem('cartCount', String(state.cartCount));
    els.cartBadge.textContent = String(state.cartCount);
    els.cartBadge.hidden = state.cartCount <= 0;
  }

  function renderProduct(product) {
    state.product = product;

    els.image.src = product.image;
    els.image.alt = product.name;

    els.name.textContent = product.name;
    els.ratingValue.textContent = formatRating(product.rating);
    els.reviewCount.textContent = `(${product.reviewCount.toLocaleString('de-DE')} Bewertungen)`;
    els.price.textContent = formatPrice(product.price);
    els.description.textContent = product.description;

    renderFeatures(product.features);
    setQuantity(1);

    if (state.cartCount > 0) {
      els.cartBadge.textContent = String(state.cartCount);
      els.cartBadge.hidden = false;
    }

    els.productView.hidden = false;
    els.actionBar.hidden = false;

    document.title = `${product.name} – Produktdetails`;
  }

  function showNotFound() {
    els.notFoundView.hidden = false;
    document.title = 'Produkt nicht gefunden';
  }

  /* ========================================================================
     Interaktionen
     ======================================================================== */
  function handleBuyClick() {
    updateCartBadge(state.quantity);

    const confirmedLabel = 'Zum Warenkorb hinzugefügt ✓';
    els.buyBtn.classList.add('is-added');
    els.buyBtn.disabled = true;
    els.buyBtnLabel.textContent = confirmedLabel;

    window.setTimeout(() => {
      els.buyBtn.classList.remove('is-added');
      els.buyBtn.disabled = false;
      updateBuyButtonLabel();
    }, 1500);
  }

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = 'index.html';
    }
  }

  function goToCart() {
    window.location.href = 'cart.html';
  }

  function bindEvents() {
    els.qtyMinus.addEventListener('click', () => setQuantity(state.quantity - 1));
    els.qtyPlus.addEventListener('click', () => setQuantity(state.quantity + 1));

    els.chips.forEach((chip) => {
      chip.addEventListener('click', () => setQuantity(Number(chip.dataset.qty)));
    });

    els.buyBtn.addEventListener('click', handleBuyClick);
    els.backBtn.addEventListener('click', goBack);
    els.cartBtn.addEventListener('click', goToCart);
  }

  /* ========================================================================
     Initialisierung
     ======================================================================== */
  function init() {
    cacheElements();

    const id = getProductIdFromUrl();
    const product = findProductById(id);

    if (!product) {
      showNotFound();
      return;
    }

    renderProduct(product);
    bindEvents();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
