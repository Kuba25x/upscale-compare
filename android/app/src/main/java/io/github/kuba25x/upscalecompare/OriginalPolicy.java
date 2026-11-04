package io.github.kuba25x.upscalecompare;

import java.io.*;
import java.security.*;
import java.util.function.LongSupplier;

/** Limits are independent of the web and publication limits. */
final class OriginalPolicy {
  static final long FILE_LIMIT = 256L * 1024 * 1024;
  static final long SESSION_LIMIT = 4 * FILE_LIMIT;
  static final long STORE_LIMIT = 2 * SESSION_LIMIT;
  static final long FREE_RESERVE = 256L * 1024 * 1024;

  record Copy(long size, String sha256) {}

  static Copy copy(InputStream in, OutputStream out, long limit, LongSupplier available)
      throws IOException {
    try {
      MessageDigest hash = MessageDigest.getInstance("SHA-256");
      byte[] buffer = new byte[64 * 1024];
      long size = 0;
      int count;
      while ((count = in.read(buffer)) != -1) {
        if (Thread.currentThread().isInterrupted()) throw new IOException("Import interrupted.");
        if (count == 0) continue;
        if (count > limit - size)
          throw new IOException("Original exceeds the local storage limit.");
        if (available.getAsLong() - count < FREE_RESERVE)
          throw new IOException("Not enough free device storage.");
        out.write(buffer, 0, count);
        hash.update(buffer, 0, count);
        size += count;
      }
      if (size == 0) throw new IOException("The selected file is empty.");
      StringBuilder hex = new StringBuilder();
      for (byte b : hash.digest()) hex.append(String.format("%02x", b & 255));
      return new Copy(size, hex.toString());
    } catch (NoSuchAlgorithmException e) {
      throw new IOException(e);
    }
  }

  static void sweep(File root, java.util.Set<String> keep) throws IOException {
    File[] files = root.listFiles();
    if (files == null) throw new IOException("Cannot inspect private storage.");
    for (File file : files) {
      if (!keep.contains(file.getName()) && !file.delete())
        throw new IOException("Could not remove an unused original.");
    }
  }

  static void dimensions(int width, int height) throws IOException {
    if (width <= 0
        || height <= 0
        || width > 16384
        || height > 16384
        || (long) width * height > 36_000_000)
      throw new IOException("Images must be at most 36 megapixels and 16,384 pixels per side.");
  }
}
