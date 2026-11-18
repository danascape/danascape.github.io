#!/usr/bin/env ruby
#
# Pre-compute each post's reading time as `read_minutes`, using the same rule as
# Chirpy's _includes/read-time.html (rendered HTML, tags stripped, 180 wpm, min 1).
# The series strip (_includes/series-nav.html) sums these for the series total, so it
# matches the "N min read" readers see on each part.

Jekyll::Hooks.register :site, :post_read do |site|
  converter = site.find_converter_instance(Jekyll::Converters::Markdown)

  site.posts.docs.each do |post|
    html = converter.convert(post.content.to_s)
    text = html.gsub(%r{<(script|style)[^>]*>.*?</\1>}m, '').gsub(/<[^>]*>/, '')
    words = text.split.size
    post.data['read_minutes'] = [words / 180, 1].max
  end
end
