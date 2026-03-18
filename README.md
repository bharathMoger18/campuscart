# CampusCart 🛒

A full-stack e-commerce web application built for campus communities.

## Tech Stack

**Frontend:** HTML, CSS, JavaScript  
**Backend:** Django 5, Django REST Framework  
**Real-time:** Django Channels, Daphne, Redis  
**Payments:** Stripe  
**Auth:** JWT (SimpleJWT)  
**Database:** SQLite  

## Features

- 🔐 JWT Authentication (register, login, email verification)
- 🛍️ Product listings with search and filters
- 🛒 Cart and wishlist management
- 📦 Order creation and tracking
- 💳 Stripe payment integration
- 💬 Real-time chat (WebSockets)
- 🔔 Push notifications
- ⭐ Product reviews
- 👤 Seller dashboard

## Project Structure
```
campuscart/
├── campuscart-backend/   # Django REST API
│   ├── campuscart/       # Project settings
│   ├── users/            # Auth & user management
│   ├── products/         # Product listings
│   ├── cart/             # Shopping cart
│   ├── orders/           # Order management
│   ├── payments/         # Stripe integration
│   ├── chat/             # Real-time chat
│   ├── push/             # Push notifications
│   ├── reviews/          # Product reviews
│   └── wishlist/         # Wishlist
└── frontend/             # HTML/CSS/JS frontend
```

## Local Setup
```bash
# Clone the repository
git clone https://github.com/yourusername/campuscart.git
cd campuscart

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r campuscart-backend/requirements.txt

# Setup environment variables
cp campuscart-backend/.env.example campuscart-backend/.env
# Edit .env with your values

# Run migrations
cd campuscart-backend
python manage.py migrate

# Start Redis (required for chat & notifications)
# Start Daphne
daphne -p 8000 campuscart.asgi:application
```

## Environment Variables

See `.env.example` for required environment variables.

## License

MIT
