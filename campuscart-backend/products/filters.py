# products/filters.py
import django_filters
from .models import Product

class ProductFilter(django_filters.FilterSet):
    min_price = django_filters.NumberFilter(field_name="price", lookup_expr="gte")
    max_price = django_filters.NumberFilter(field_name="price", lookup_expr="lte")
    category = django_filters.CharFilter(field_name="category", lookup_expr="iexact")
    is_available = django_filters.BooleanFilter(field_name="is_available")

    class Meta:
        model = Product
        fields = ["category", "is_available", "min_price", "max_price"]
