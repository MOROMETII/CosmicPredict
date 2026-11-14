"""Engagement scoring for sky-region reels (the Sky Scroll feed).

A region's score measures *how much people interacted with it*, not how
scientifically interesting it is. It is deliberately simple and transparent:

    score = 5 * flags + 2 * comments + 1 * gifs + 3 * people + 1 * saves

where:
- ``flags``   — user "this looks suspicious" bookmarks on the region;
- ``comments``— comments posted on the region;
- ``gifs``    — comments that contain a GIF;
- ``people``  — distinct authors who commented (breadth of engagement);
- ``saves``   — double-tap "saves" (likes) on the region.

The score is used only to order the social feed. It is not a detection or a
scientific ranking, and a high score does not make a region "more real".
"""

from __future__ import annotations

from typing import Any

from backend.storage import comments as comments_store
from backend.storage import marks as marks_store
from backend.storage import saves as saves_store

_FLAG_WEIGHT = 5
_COMMENT_WEIGHT = 2
_GIF_WEIGHT = 1
_PERSON_WEIGHT = 3
_SAVE_WEIGHT = 1


def region_score(region_key: str) -> dict[str, Any]:
    """Compute the engagement score and breakdown for one region."""
    flags = 0
    for mark in marks_store.list_marks():
        if mark.get("region_key") == region_key:
            flags += 1

    thread = comments_store.list_comments(region_key)
    comments = len(thread)
    gifs = sum(1 for comment in thread if comment.get("gif_url"))
    people = len({comment.get("author") for comment in thread if comment.get("author")})
    saves = saves_store.count_saves(region_key)

    score = (
        _FLAG_WEIGHT * flags
        + _COMMENT_WEIGHT * comments
        + _GIF_WEIGHT * gifs
        + _PERSON_WEIGHT * people
        + _SAVE_WEIGHT * saves
    )
    return {
        "score": score,
        "flags": flags,
        "comments": comments,
        "gifs": gifs,
        "people": people,
        "saves": saves,
    }


def all_scores() -> dict[str, dict[str, Any]]:
    """Scores for every region that has any interaction, keyed by region_key."""
    keys: set[str] = set()
    for mark in marks_store.list_marks():
        if mark.get("region_key"):
            keys.add(mark["region_key"])
    for comment in comments_store.list_comments_all():
        if comment.get("region_key"):
            keys.add(comment["region_key"])
    for save in saves_store.list_saves():
        if save.get("region_key"):
            keys.add(save["region_key"])
    return {key: region_score(key) for key in keys}
