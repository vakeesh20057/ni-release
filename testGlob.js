const regex = /\.neural-inverse(?:-dev)?\/artifacts\/.*\.md$/;
const path = "/Users/sanjaysenthilkumar/Library/Application Support/.neural-inverse-dev/artifacts/task.md";
console.log(path.match(regex) !== null);

const glob = "**/.neural-inverse*/artifacts/*.md";
// VS Code might use standard glob-to-regex
