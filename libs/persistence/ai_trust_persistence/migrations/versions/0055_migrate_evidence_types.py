"""Migrate evidence types: code→document, function_is_used→document

Revision ID: 0055
Revises: 0054
Create Date: 2026-11-25

Aligns evidence type values with the canonical product terminology
(product-terminology-final-2026-10-28.docx §5.4). The superseded types
'code' and 'function_is_used' are remapped to 'document' (the closest
canonical equivalent).
"""

from alembic import op

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE evidence SET evidence_type = 'document' WHERE evidence_type IN ('code', 'function_is_used')")


def downgrade() -> None:
    # Reverse mapping is lossy — both types collapsed to 'document'.
    # Downgrade leaves them as 'document' (safest; no data invented).
    pass
