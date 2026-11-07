package io.github.kuba25x.upscalecompare;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import java.io.IOException;
import java.util.List;

/** Contract construction/parsing is separate from Capacitor's lifecycle-owned launcher. */
final class ImageSelection {
  final int minimum;
  final int limit;
  final String source;

  ImageSelection(int minimum, int limit, String source) throws IOException {
    if (minimum < 1 || limit < minimum || limit > 4)
      throw new IOException("Invalid image selection limits.");
    if (!"photos".equals(source) && !"files".equals(source))
      throw new IOException("Choose Photos or Files as the image source.");
    this.minimum = minimum;
    this.limit = limit;
    this.source = source;
  }

  Intent createIntent(Context context) {
    if (source.equals("files")) return documentsIntent();
    PickVisualMediaRequest request =
        new PickVisualMediaRequest.Builder()
            .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
            .build();
    Intent intent =
        limit == 1
            ? new ActivityResultContracts.PickVisualMedia().createIntent(context, request)
            : new ActivityResultContracts.PickMultipleVisualMedia(limit)
                .createIntent(context, request);
    // AndroidX chooses the platform/OEM Photo Picker, or SAF if unavailable.
    return Intent.ACTION_OPEN_DOCUMENT.equals(intent.getAction()) ? documentsIntent() : intent;
  }

  Intent documentsIntent() {
    return new Intent(Intent.ACTION_OPEN_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType("image/*")
        .putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"image/png", "image/jpeg", "image/webp"})
        .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, limit > 1)
        .putExtra(Intent.EXTRA_LOCAL_ONLY, true)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
  }

  List<Uri> parseResult(int resultCode, Intent data) {
    // The multi parser also handles vendor single results in ClipData and deduplicates URIs.
    // Checking the returned count separately also protects the SAF fallback, which has no cap.
    return new ActivityResultContracts.PickMultipleVisualMedia(Math.max(2, limit))
        .parseResult(resultCode, data);
  }

  void validate(List<Uri> uris) throws IOException {
    if (uris.size() < minimum)
      throw new IOException(
          "Select at least "
              + minimum
              + " images for a new comparison. Your current comparison has not changed.");
    if (uris.size() > limit)
      throw new IOException("Select no more than " + limit + " image" + (limit == 1 ? "." : "s."));
    for (Uri uri : uris)
      if (uri == null || !"content".equals(uri.getScheme()))
        throw new IOException("The picker must return readable content URIs.");
  }
}
