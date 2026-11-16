// Read only bounded public APK metadata. No extraction, application code or private keys.
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.zip.ZipFile;

class AndroidReleaseArchive {
  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("Expected one APK path");
    String[] names = {"build-info.json", "LICENSE.txt", "third-party-licenses.txt"};
    try (ZipFile zip = new ZipFile(args[0], StandardCharsets.UTF_8)) {
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
