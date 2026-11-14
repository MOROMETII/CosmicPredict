"""Likes-based ranking for sky-region reels (the Sky Scroll feed).

A region's score is simply how many people liked it. Simple and transparent:

    score = likes

The score is used only to order the leaderboard and the social feed. It is not
a detection or a scientific ranking, and a high score does not make a region
"more real".
"""

from __future__ import annotations

from typing import Any

from backend.storage import likes as likes_store


def region_score(region_key: str) -> dict[str, Any]:
    """Compute the like count for one region."""
    likes = likes_store.count_likes(region_key)
    return {"score": likes, "likes": likes}


def all_scores() -> dict[str, dict[str, Any]]:
    """Like counts for every region that has any likes, keyed by region_key."""
    keys: set[str] = set()
    for like in likes_store.list_likes():
        if like.get("region_key"):
            keys.add(like["region_key"])
    return {key: region_score(key) for key in keys}
