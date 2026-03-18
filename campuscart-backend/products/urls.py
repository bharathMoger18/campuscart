from rest_framework.routers import DefaultRouter
from .views import ProductViewSet, SellerProductViewSet

router = DefaultRouter()
router.register(r"products", ProductViewSet, basename="product")
router.register(r"seller/products", SellerProductViewSet, basename="seller-product")

urlpatterns = router.urls
