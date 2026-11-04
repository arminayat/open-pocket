import Foundation

@main
struct OAuthLoopbackChecks {
  static func main() {
    func location(_ request: String) -> String? {
      PocketOAuthLoopback.redirectLocation(for: Data(request.utf8))
    }
    precondition(location("GET /callback?code=abc-1_2&state=x.y~z HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
      == "openpocket://oauth/callback?code=abc-1_2&state=x.y~z")
    precondition(location("GET /callback?error=access_denied&state=s HTTP/1.1\r\n\r\n")
      == "openpocket://oauth/callback?error=access_denied&state=s")
    // Only the callback path is relayed, and header injection characters are refused.
    for request in [
      "GET /other?code=a HTTP/1.1\r\n\r\n",
      "POST /callback?code=a HTTP/1.1\r\n\r\n",
      "GET /callback HTTP/1.1\r\n\r\n",
      "GET /callback? HTTP/1.1\r\n\r\n",
      "GET /callback?code=a\"b HTTP/1.1\r\n\r\n",
      "GET /callback?code=a%0D%0A HTTP/1.1 extra\r\n\r\n",
      "garbage",
    ] { precondition(location(request) == nil, "Unexpected relay for \(request)") }
    print("OAuth loopback checks passed")
  }
}
