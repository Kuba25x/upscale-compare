// Trusted SDK entry point and bounded APK metadata reader. No extraction or password transport.
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.zip.ZipFile;
import java.nio.file.Path;
import java.net.URLClassLoader;
import java.lang.reflect.InvocationTargetException;

class AndroidReleaseArchive {
  public static void main(String[] args) throws Exception {
    if (args.length < 2) throw new IllegalArgumentException("Expected a tool and encoded arguments");
    // Only public paths/options use this transport. Passwords stay on the inherited console.
    String[] decoded = new String[args.length - 1];
    for (int i = 1; i < args.length; i++) {
      decoded[i - 1] = new String(Base64.getDecoder().decode(args[i]), StandardCharsets.UTF_8);
    }
    if (args[0].equals("apksigner")) {
      try (var loader = new URLClassLoader(
          new java.net.URL[] {Path.of(decoded[0]).toUri().toURL()},
          ClassLoader.getPlatformClassLoader())) {
        String[] options = java.util.Arrays.copyOfRange(decoded, 1, decoded.length);
        try {
          loader.loadClass("com.android.apksigner.ApkSignerTool")
              .getMethod("main", String[].class).invoke(null, (Object) options);
        } catch (InvocationTargetException failed) {
          throw new RuntimeException(failed.getCause());
        }
      }
      return;
    }
    if (!args[0].equals("archive") || decoded.length != 1) {
      throw new IllegalArgumentException("Unsupported release tool");
    }
    String[] names = {"build-info.json", "LICENSE.txt", "third-party-licenses.txt"};
    try (ZipFile zip = new ZipFile(decoded[0], StandardCharsets.UTF_8)) {
      for (String name : names) {
        String path = "assets/public/" + name;
        var entries = zip.stream().filter(entry -> entry.getName().equals(path)).toList();
        if (entries.size() != 1 || entries.get(0).isDirectory()) {
          throw new IllegalArgumentException("Missing or duplicate APK metadata: " + name);
        }
        int limit = name.equals("build-info.json") ? 64 * 1024 : 2 * 1024 * 1024;
        if (entries.get(0).getSize() > limit) {
          throw new IllegalArgumentException("Oversized APK metadata: " + name);
        }
        try (var input = zip.getInputStream(entries.get(0))) {
          byte[] bytes = input.readNBytes(limit + 1);
          if (bytes.length > limit) throw new IllegalArgumentException("Oversized APK metadata");
          System.out.println(Base64.getEncoder().encodeToString(bytes));
        }
      }
    }
  }
}
