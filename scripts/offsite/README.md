# Off-site backup via wormhole.app

Clean-room uploader and round-trip verifier for wormhole.app, rebuilt from
the public web bundle and the SocketDev wormhole-crypto package. The file is
stream-encrypted end to end (AES-256-GCM, RFC 8188 record framing), packed
as an encrypted single-file torrent, stored on Backblaze B2, and the 16-byte
key travels only in the URL fragment. The server never sees plaintext.

Usage (dependencies are installed ad hoc in a scratch directory, they are not
app dependencies):

    bun add wormhole-crypto create-torrent parse-torrent piece-length
    bun whput2.mjs <file>          # prints the link, sha256, expiry
    bun whverify2.mjs <link> <outfile|-> [expectedSha256]

Verify before reporting a link: whverify2 downloads every piece, checks each
piece sha1 against the torrent metadata, decrypts, and compares sha256 with
the source. A link is only reported after this passes. Links expire after
24 hours or 100 downloads; the recipient page at wormhole.app accepts these
rooms without any special steps.
