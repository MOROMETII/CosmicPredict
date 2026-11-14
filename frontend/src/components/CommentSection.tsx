"use client";

import { useEffect, useState } from "react";
import { Box, Button, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { ChatBubbleOutline, Send } from "@mui/icons-material";
import { createComment, getComments, type Comment } from "@/services/api";

type Props = {
  regionKey: string;
  ra: number;
  dec: number;
};

/** A comment thread for one sky region, shown as an overlay panel. */
export default function CommentSection({ regionKey, ra, dec }: Props) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getComments(regionKey)
      .then((result) => active && setComments(result.comments))
      .catch(() => active && setComments([]));
    return () => {
      active = false;
    };
  }, [regionKey]);

  const submit = async () => {
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    setError(null);
    try {
      const comment = await createComment(regionKey, text, author.trim() || undefined);
      setComments((current) => [...(current ?? []), comment]);
      setBody("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not post the comment.");
    } finally {
      setPosting(false);
    }
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
              <Typography sx={{ color: "#e6edf5", fontSize: 13, mt: 0.25, wordBreak: "break-word" }}>
                {comment.body}
              </Typography>
            </Box>
          ))
        )}
      </Stack>

      {error && (
        <Typography variant="caption" sx={{ color: "#ff8f7d" }}>
          {error}
        </Typography>
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
            disabled={!body.trim() || posting}
            onClick={submit}
            startIcon={posting ? <CircularProgress size={14} color="inherit" /> : <Send sx={{ fontSize: 16 }} />}
          >
            Post
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}
