"""
Feast Entity definitions for Purchase Propensity Model.

Entities are the primary keys used to identify features in the feature store.
"""

from feast import Entity

# User entity - represents a unique customer/user
user = Entity(
    name="user",
    join_keys=["user_id"],
    description="Unique identifier for a user/customer",
)

# Product entity - represents a unique product
product = Entity(
    name="product",
    join_keys=["product_id"],
    description="Unique identifier for a product",
)
