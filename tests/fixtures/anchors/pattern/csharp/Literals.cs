class Literals
{
    string a = @"// @implements x#FR-001 "" still";
    string b = $"{a} // @implements x#FR-001 {(a.Length > 0 ? "/*" : "*/")}";
    string c = $@"{a} // @implements x#FR-001";
    string d = """
        // @implements x#FR-001
        """;
    char e = '/';
}
