package io.github.kuba25x.upscalecompare;

import static org.junit.Assert.*;

import java.io.*;
import java.security.MessageDigest;
import java.util.Arrays;
import org.junit.Test;

public class OriginalPolicyTest {
  @Test
  public void cleanupRetainsCommittedAndPendingOriginals() throws Exception {
    var root = java.nio.file.Files.createTempDirectory("original-retention");
    try {
      for (String name : new String[] {"committed", "pending", "orphan"})
        java.nio.file.Files.write(root.resolve(name), new byte[] {42});
      OriginalPolicy.sweep(root.toFile(), java.util.Set.of("committed", "pending"));
      assertTrue(java.nio.file.Files.exists(root.resolve("committed")));
      assertTrue(java.nio.file.Files.exists(root.resolve("pending")));
      assertFalse(java.nio.file.Files.exists(root.resolve("orphan")));
      OriginalPolicy.sweep(root.toFile(), java.util.Set.of());
      assertEquals(0, root.toFile().listFiles().length);
    } finally {
      java.nio.file.Files.delete(root);
    }
  }

  @Test
  public void failedCleanupDoesNotRecursivelyDeleteUnknownDirectories() throws Exception {
    var root = java.nio.file.Files.createTempDirectory("original-retention");
    var sub = java.nio.file.Files.createDirectory(root.resolve("unexpected"));
    var file = java.nio.file.Files.write(sub.resolve("keep"), new byte[] {42});
    try {
      assertThrows(
          IOException.class, () -> OriginalPolicy.sweep(root.toFile(), java.util.Set.of()));
      assertTrue(java.nio.file.Files.exists(file));
    } finally {
      java.nio.file.Files.delete(file);
      java.nio.file.Files.delete(sub);
      java.nio.file.Files.delete(root);
    }
  }

  @Test
  public void preservesOriginalBytesAcrossChunks() throws Exception {
    byte[] input = new byte[200001];
    new java.util.Random(42).nextBytes(input);
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    OriginalPolicy.Copy result =
        OriginalPolicy.copy(
            new ByteArrayInputStream(input), output, input.length, () -> Long.MAX_VALUE);
    assertArrayEquals(input, output.toByteArray());
    assertEquals(input.length, result.size());
    StringBuilder hex = new StringBuilder();
    for (byte b : MessageDigest.getInstance("SHA-256").digest(input))
      hex.append(String.format("%02x", b & 255));
    assertEquals(hex.toString(), result.sha256());
  }

  @Test
  public void rejectsUnknownLengthOverLimitBeforeWritingExcess() throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    assertThrows(
        IOException.class,
        () ->
            OriginalPolicy.copy(
                new ByteArrayInputStream(new byte[65537]), out, 65536, () -> Long.MAX_VALUE));
    assertEquals(65536, out.size());
  }

  @Test
  public void refusesLowStorageAndEmptyFiles() {
    assertThrows(
        IOException.class,
        () ->
            OriginalPolicy.copy(
                new ByteArrayInputStream(new byte[1]),
                new ByteArrayOutputStream(),
                10,
                () -> OriginalPolicy.FREE_RESERVE));
    assertThrows(
        IOException.class,
        () ->
            OriginalPolicy.copy(
                new ByteArrayInputStream(new byte[0]),
                new ByteArrayOutputStream(),
                10,
                () -> Long.MAX_VALUE));
  }

  @Test
  public void accepts8kButRejectsOversizedHeaders() throws Exception {
    OriginalPolicy.dimensions(7680, 4320);
    assertThrows(IOException.class, () -> OriginalPolicy.dimensions(16385, 1));
    assertThrows(IOException.class, () -> OriginalPolicy.dimensions(8000, 8000));
    assertThrows(IOException.class, () -> OriginalPolicy.dimensions(0, 4320));
  }

  @Test
  public void streamsExactProvisionalLimitWithBoundedBuffers() throws Exception {
    InputStream generated =
        new InputStream() {
          long left = OriginalPolicy.FILE_LIMIT;

          public int read() {
            if (left == 0) return -1;
            left--;
            return 0;
          }

          public int read(byte[] b, int off, int len) {
            if (left == 0) return -1;
            int n = (int) Math.min(left, len);
            Arrays.fill(b, off, off + n, (byte) 0);
            left -= n;
            return n;
          }
        };
    var result =
        OriginalPolicy.copy(
            generated,
            OutputStream.nullOutputStream(),
            OriginalPolicy.FILE_LIMIT,
            () -> Long.MAX_VALUE);
    assertEquals(OriginalPolicy.FILE_LIMIT, result.size());
  }
}
