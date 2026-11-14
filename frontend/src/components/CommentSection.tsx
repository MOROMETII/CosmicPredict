"use client";

import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Popover,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ChatBubbleOutline, GifBox, Send } from "@mui/icons-material";
import { createComment, getComments, searchGifs, type Comment, type Gif } from "@/services/api";

type Props = {
  regionKey: string;
  ra: number;
  dec: number;
};

/** A comment thread for one sky region, shown beside the reel. */
export default function CommentSection({ regionKey, ra, dec }: Props) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [gif, setGif] = useState<Gif | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GIF picker state.
  const [gifAnchor, setGifAnchor] = useState<HTMLElement | null>(null);
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const gifTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    getComments(regionKey)
      .then((result) => active && setComments(result.comments))
      .catch(() => active && setComments([]));
    return () => {
      active = false;
    };
  }, [regionKey]);

  useEffect(() => {
    let active = true;
    if (gifTimer.current) window.clearTimeout(gifTimer.current);
    gifTimer.current = window.setTimeout(() => {
      setGifLoading(true);
      searchGifs(gifQuery)
        .then((result) => active && setGifs(result))
        .catch(() => active && setGifs([]))
        .finally(() => active && setGifLoading(false));
    }, 250);
    return () => {
      active = false;
    };
  }, [gifQuery]);

  const submit = async () => {
    const text = body.trim();
    if ((!text && !gif) || posting) return;
    setPosting(true);
    setError(null);
    try {
      const comment = await createComment(regionKey, text, author.trim() || undefined, {
        body: text,
        gif_url: gif?.gif_url ?? null,
        gif_still_url: gif?.preview_url ?? null,
        gif_title: gif?.title ?? null,
      });
      setComments((current) => [...(current ?? []), comment]);
      setBody("");
      setGif(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not post the comment.");
    } finally {
      setPosting(false);
    }
  };

  const pickGif = (selected: Gif) => {
    setGif(selected);
    setGifAnchor(null);
  };

  return (
    <Stack spacing={1.5} sx={{ height: "100%" }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <ChatBubbleOutline sx={{ color: "#ffb74d", fontSize: 20 }} />
        <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>
          Comments · RA {ra.toFixed(2)}° Dec {dec.toFixed(2)}°
        </Typography>
      </Stack>

      <Stack spacing={1} sx={{ flex: 1, overflowY: "auto", minHeight: 0, pr: 0.5 }}>
        {comments === null ? (
          <Stack alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={20} sx={{ color: "#5b6b82" }} />
          </Stack>
        ) : comments.length === 0 ? (
          <Typography variant="body2" sx={{ color: "#8b97a8" }}>
            No comments yet — start the discussion.
          </Typography>
        ) : (
          comments.map((comment) => (
            <Box key={comment.id} sx={{ bgcolor: "rgba(255,255,255,.06)", borderRadius: 2, p: 1.25 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                <Typography sx={{ color: "#ffd890", fontWeight: 700, fontSize: 12 }}>{comment.author}</Typography>
                <Typography sx={{ color: "#8b97a8", fontSize: 10 }}>
                  {new Date(comment.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </Typography>
              </Stack>
              {comment.body && (
                <Typography sx={{ color: "#e6edf5", fontSize: 13, mt: 0.25, wordBreak: "break-word" }}>
                  {comment.body}
                </Typography>
              )}
              {comment.gif_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={comment.gif_url}
                  alt={comment.gif_title ?? "GIF"}
                  loading="lazy"
                  style={{ marginTop: 6, maxWidth: "100%", borderRadius: 8, display: "block" }}
                />
              )}
            </Box>
          ))
        )}
      </Stack>

      {error && (
        <Typography variant="caption" sx={{ color: "#ff8f7d" }}>
          {error}
        </Typography>
      )}

      {gif && (
        <Stack direction="row" spacing={1} alignItems="center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={gif.preview_url} alt={gif.title} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />
          <Typography variant="caption" sx={{ color: "#8b97a8", flex: 1 }}>
            {gif.title}
          </Typography>
          <IconButton size="small" onClick={() => setGif(null)} sx={{ color: "#8b97a8" }}>
            <Send sx={{ fontSize: 14, transform: "rotate(180deg)" }} />
          </IconButton>
        </Stack>
      )}

      <Stack spacing={1}>
        <TextField
          size="small"
          placeholder="Your name (optional)"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          inputProps={{ maxLength: 64 }}
          sx={{
            "& .MuiOutlinedInput-root": { color: "#e6edf5" },
            "& .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,.2)" },
            "& .MuiInputLabel-root": { color: "#8b97a8" },
          }}
        />
        <Stack direction="row" spacing={1} alignItems="flex-end">
          <IconButton onClick={(event) => setGifAnchor(event.currentTarget)} sx={{ color: "#8b97a8" }} aria-label="Add a GIF">
            <GifBox />
          </IconButton>
          <TextField
            size="small"
            fullWidth
            multiline
            maxRows={3}
            placeholder="Add a comment…"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            inputProps={{ maxLength: 2000 }}
            sx={{
              "& .MuiOutlinedInput-root": { color: "#e6edf5" },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,.2)" },
            }}
          />
          <Button
            variant="contained"
            size="small"
            disabled={(!body.trim() && !gif) || posting}
            onClick={submit}
            startIcon={posting ? <CircularProgress size={14} color="inherit" /> : <Send sx={{ fontSize: 16 }} />}
          >
            Post
          </Button>
        </Stack>
      </Stack>

      <Popover
        open={Boolean(gifAnchor)}
        anchorEl={gifAnchor}
        onClose={() => setGifAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { bgcolor: "#12151c", border: "1px solid rgba(255,255,255,.15)", borderRadius: 2, width: 320, maxHeight: 420, overflow: "hidden" } } }}
      >
        <Stack spacing={1} sx={{ p: 1.5, height: "100%" }}>
          <TextField
            size="small"
            fullWidth
            autoFocus
            placeholder="Search GIFs…"
            value={gifQuery}
            onChange={(event) => setGifQuery(event.target.value)}
            sx={{
              "& .MuiOutlinedInput-root": { color: "#e6edf5" },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,.2)" },
            }}
          />
          <Box sx={{ overflowY: "auto", maxHeight: 320 }}>
            {gifLoading && gifs.length === 0 ? (
              <Stack alignItems="center" sx={{ py: 3 }}>
                <CircularProgress size={20} sx={{ color: "#5b6b82" }} />
              </Stack>
            ) : gifs.length === 0 ? (
              <Typography variant="body2" sx={{ color: "#8b97a8", py: 2, textAlign: "center" }}>
                No GIFs found.
              </Typography>
            ) : (
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                {gifs.map((item) => (
                  <Box
                    key={item.id}
                    component="button"
                    onClick={() => pickGif(item)}
                    sx={{
                      position: "relative",
                      aspectRatio: "1",
                      p: 0,
                      border: "none",
                      borderRadius: 1,
                      overflow: "hidden",
                      cursor: "pointer",
                      bgcolor: "rgba(255,255,255,.05)",
                      "&:hover": { outline: "2px solid #ffb74d" },
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.preview_url} alt={item.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Stack>
      </Popover>
    </Stack>
  );
}
