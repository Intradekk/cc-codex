//! Subscription status line adapted from the Claude Code statusline script.

use ratatui::style::Color;
use ratatui::style::Style;
use ratatui::text::Line;
use ratatui::text::Span;

use crate::status::format_tokens_compact;
use crate::style::readable_color_on;
use crate::style::secondary_text_style;
use crate::terminal_palette::StdoutColorLevel;
use crate::terminal_palette::effective_stdout_color_level;
use crate::terminal_palette::rgb_color;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ClaudeStatusLine {
    pub(crate) model: String,
    pub(crate) cwd: String,
    pub(crate) branch: Option<String>,
    /// Label, percent used, and reset time in Unix seconds.
    pub(crate) limit: Option<(String, u8, Option<i64>)>,
    /// Latest prompt input tokens (including cached input), and context capacity.
    pub(crate) context: Option<(i64, Option<i64>)>,
}

impl ClaudeStatusLine {
    pub(crate) fn render(&self, use_colors: bool, now: i64) -> Line<'static> {
        let secondary = secondary_text_style();
        let mut spans = vec![Span::raw(format!("🤖 {} | 📁 {}", self.model, self.cwd))];
        if let Some(branch) = &self.branch {
            spans.push(Span::raw(format!(" | 🌿 {branch}")));
        }
        if let Some((label, percent, resets_at)) = &self.limit {
            spans.push(Span::raw(format!(" | {label}: ")));
            let style = if use_colors {
                Style::default().fg(limit_color(*percent, effective_stdout_color_level()))
            } else {
                Style::default()
            };
            spans.push(Span::styled(format!("{percent}%"), style));
            if let Some(resets_at) = resets_at {
                let minutes = resets_at.saturating_sub(now).max(0).saturating_add(59) / 60;
                spans.push(Span::styled(format!(" ({minutes}m)"), secondary));
            }
        }
        if let Some((used, capacity)) = self.context {
            let capacity = capacity
                .filter(|capacity| *capacity > 0)
                .map(format_tokens_compact)
                .unwrap_or_else(|| "?".to_string());
            spans.push(Span::raw(format!(
                " | ctx: {}/{capacity}",
                format_tokens_compact(used),
            )));
        }
        Line::from(spans)
    }
}

fn limit_color(percent: u8, color_level: StdoutColorLevel) -> Color {
    let (rgb, ansi) = if percent >= 80 {
        ((255, 0, 0), Color::Red)
    } else if percent >= 50 {
        ((255, 215, 0), Color::Yellow)
    } else {
        ((135, 215, 135), Color::Green)
    };
    if color_level == StdoutColorLevel::Ansi16 {
        ansi
    } else {
        readable_color_on(rgb_color(rgb), /*background*/ None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_blocks_and_reset_countdown_without_inventing_missing_data() {
        let mut data = ClaudeStatusLine {
            model: "gpt-5 (high)".into(),
            cwd: "~/code".into(),
            branch: Some("main".into()),
            limit: Some(("5h".into(), 10, Some(161))),
            context: Some((75_000, Some(1_000_000))),
        };
        assert_eq!(
            data.render(false, 100).to_string(),
            "🤖 gpt-5 (high) | 📁 ~/code | 🌿 main | 5h: 10% (2m) | ctx: 75K/1M",
        );
        data.branch = None;
        data.limit = Some(("7d".into(), 80, Some(99)));
        data.context = Some((0, None));
        assert_eq!(
            data.render(false, 100).to_string(),
            "🤖 gpt-5 (high) | 📁 ~/code | 7d: 80% (0m) | ctx: 0/?",
        );
        data.limit = None;
        data.context = None;
        assert_eq!(
            data.render(false, 100).to_string(),
            "🤖 gpt-5 (high) | 📁 ~/code",
        );
    }

    #[test]
    fn colors_usage_thresholds_and_fits_a_narrow_footer() {
        use ratatui::buffer::Buffer;
        use ratatui::layout::Rect;
        use ratatui::widgets::Widget;

        crate::terminal_palette::with_test_default_colors(
            crate::terminal_probe::DefaultColors {
                fg: (220, 220, 220),
                bg: (20, 20, 20),
            },
            || {
                let mut data = ClaudeStatusLine {
                    model: "gpt-5 (high)".into(),
                    cwd: "~/long/project/path".into(),
                    branch: None,
                    limit: None,
                    context: None,
                };
                for (percent, rgb, ansi) in [
                    (49, (135, 215, 135), Color::Green),
                    (50, (255, 215, 0), Color::Yellow),
                    (79, (255, 215, 0), Color::Yellow),
                    (80, (255, 0, 0), Color::Red),
                ] {
                    data.limit = Some(("5h".into(), percent, None));
                    let line = data.render(true, 0);
                    assert_eq!(
                        line.spans.last().unwrap().style.fg,
                        Some(readable_color_on(rgb_color(rgb), None)),
                    );
                    assert_eq!(limit_color(percent, StdoutColorLevel::Ansi16), ansi);
                    assert_eq!(
                        data.render(false, 0).spans.last().unwrap().style,
                        Style::default(),
                    );
                    let area = Rect::new(0, 0, 20, 1);
                    let mut buffer = Buffer::empty(area);
                    crate::line_truncation::truncate_line_with_ellipsis_if_overflow(line, 20)
                        .render(area, &mut buffer);
                    assert!(buffer.cell((0, 0)).unwrap().symbol().starts_with('🤖'));
                }
            },
        );
    }
}
